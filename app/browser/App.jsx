import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CalendarDays, Check, ChevronLeft, ClipboardList, Minus, MoveRight, X } from 'lucide-react'

/* =========================================================
   目標達成アプリ（ブラウザ版）
   - データはこのアプリの保存領域（window.storage）に保存
   - AIはClaude APIをその場で呼ぶ
   - Web Push通知は送れないため、開いたときに組み直し案を表示する
   ========================================================= */

const KEY = 'goal-app-state-v1'
const WD = ['日', '月', '火', '水', '木', '金', '土']

// ---------- 日付（Asia/Tokyo、'YYYY-MM-DD'で扱う） ----------
const toUTC = (d) => {
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd))
}
const fromUTC = (dt) => dt.toISOString().slice(0, 10)
const addDays = (d, n) => {
  const dt = toUTC(d)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUTC(dt)
}
const weekdayOf = (d) => toUTC(d).getUTCDay()
// デモ用：日付を何日進めているか（保存データの day_offset と同期）
let DAY_OFFSET = 0
const nowDate = () => new Date(Date.now() + DAY_OFFSET * 86400000)
const nowISO = () => nowDate().toISOString()
const jstDate = (date = nowDate()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
const daysBetween = (a, b) => {
  const out = []
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d)
  return out
}
const md = (d) => {
  const dt = toUTC(d)
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`
}
const shortLabel = (d) => `${md(d)}（${WD[weekdayOf(d)]}）`
const longLabel = (d) => {
  const dt = toUTC(d)
  return `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日（${WD[weekdayOf(d)]}）`
}
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
const byDate = (a, b) => a.date.localeCompare(b.date)

// ---------- 崩れの判定と組み直しのルール ----------
/** 予定のある日が2日連続で「できなかった」なら崩れた。今日は「今日はムリ」を押したときだけ数える */
function detectBreak(tasks, today, cutoff) {
  const relevant = tasks.filter((t) => t.date <= today && (!cutoff || t.date >= cutoff))
  const map = new Map()
  for (const t of relevant) map.set(t.date, [...(map.get(t.date) || []), t])
  const dates = [...map.keys()].sort().reverse()
  const missedDays = []
  const missedTasks = []
  for (const date of dates) {
    const list = map.get(date)
    if (list.some((t) => t.status === 'done')) break
    if (date === today && !list.some((t) => t.status === 'missed')) continue
    missedDays.push(date)
    missedTasks.push(...list.filter((t) => t.status !== 'done'))
  }
  missedDays.reverse()
  missedTasks.sort(byDate)
  return { broken: missedDays.length >= 2, missedDays, missedTasks }
}

/** 今日（記録済みなら明日）から最大14日、期限まで。予定可能な曜日で、できた日を除く */
function buildWindow(plan, tasks, today) {
  const todayRecorded = tasks.some((t) => t.date === today && t.status !== 'pending')
  const windowStart = todayRecorded ? addDays(today, 1) : today
  const cap = addDays(windowStart, 13)
  let windowEnd = plan.deadline < cap ? plan.deadline : cap
  if (windowEnd < windowStart) windowEnd = addDays(windowStart, 6)
  const doneDates = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.date))
  let days = daysBetween(windowStart, windowEnd).filter(
    (d) => plan.available_weekdays.includes(weekdayOf(d)) && !doneDates.has(d),
  )
  if (days.length === 0) days = [windowStart]
  return { windowStart, windowEnd, days }
}

/** 入りきらないときは、後ろから隣どうしを「要点だけ」として1つにまとめる（順番は保つ） */
function mergeToFit(items, slots) {
  const SUFFIX = '（要点だけ）'
  const list = [...items]
  let i = list.length - 2
  while (list.length > slots && list.length > 1) {
    if (i < 0) i = list.length - 2
    const a = list[i]
    const b = list[i + 1]
    list.splice(i, 2, {
      title: `${a.title.replace(SUFFIX, '')}／${b.title.replace(SUFFIX, '')}${SUFFIX}`,
      minutes: Math.max(a.minutes, b.minutes),
      from: a.from,
      original_date: a.original_date,
    })
    i -= 2
  }
  return list
}

function place(items, days, daily) {
  return items.map((it, i) => ({
    date: days[i],
    title: it.title,
    minutes: Math.min(it.minutes, daily),
    original_date: it.from !== days[i] ? it.original_date || it.from : it.original_date || null,
  }))
}

/** AIが失敗したときの予備：遅れた分 → 範囲内の予定 の順に、空いている日へ順番に詰める */
function fallbackReplan(plan, win, missedTasks, pending) {
  const items = [...missedTasks, ...[...pending].sort(byDate)].map((t) => ({
    title: t.title,
    minutes: t.minutes,
    from: t.date,
    original_date: t.original_date,
  }))
  return place(mergeToFit(items, win.days.length), win.days, plan.daily_minutes)
}

/** fromDate以降の未完了の予定を、使える日に詰め直す（「この日はムリ」で使う） */
function reflow(tasks, fromDate, days, daily) {
  const slots = days.filter((d) => d >= fromDate)
  if (slots.length === 0) return null
  const keep = tasks.filter((t) => t.date < fromDate || t.status === 'done')
  const moving = tasks
    .filter((t) => t.date >= fromDate && t.status !== 'done')
    .sort(byDate)
    .map((t) => ({ title: t.title, minutes: t.minutes, from: t.date, original_date: t.original_date }))
  return [...keep, ...place(mergeToFit(moving, slots.length), slots, daily)].sort(byDate)
}

function validateTasks(tasks, allowedDays, daily) {
  if (!Array.isArray(tasks) || tasks.length === 0) return '予定が空です'
  const allowed = new Set(allowedDays)
  const sum = new Map()
  for (const t of tasks) {
    if (typeof t.date !== 'string' || !allowed.has(t.date)) return `入れられない日があります：${t.date}`
    if (typeof t.title !== 'string' || !t.title.trim()) return '内容が空の予定があります'
    if (typeof t.minutes !== 'number' || t.minutes <= 0) return '時間が正しくない予定があります'
    sum.set(t.date, (sum.get(t.date) || 0) + t.minutes)
  }
  for (const [d, total] of sum) if (total > daily) return `${d} が1日の上限（${daily}分）を超えています`
  return null
}

/** 組み直しを確定してから7日以内に、予定のある日で3回連続できたら「戻れた」 */
function judge(replan, tasks, today) {
  if (!replan.confirmed_at) return { kind: 'unconfirmed' }
  const start = jstDate(new Date(replan.confirmed_at))
  const end = addDays(start, 6)
  const last = today < end ? today : end
  const map = new Map()
  for (const t of tasks) {
    if (t.date < start || t.date > last) continue
    map.set(t.date, [...(map.get(t.date) || []), t])
  }
  let streak = 0
  for (const date of [...map.keys()].sort()) {
    const list = map.get(date)
    if (list.some((t) => t.status === 'done')) {
      streak++
      if (streak >= 3) return { kind: 'returned', on: date }
    } else if (!(date === today && list.every((t) => t.status === 'pending'))) {
      streak = 0
    }
  }
  if (today > end) return { kind: 'not_returned' }
  return { kind: 'in_progress', streak, until: end }
}

// ---------- AI（Claude API） ----------
async function callClaude(system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`AIの呼び出しに失敗しました（${res.status}）`)
  const data = await res.json()
  const text = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('')
  const clean = text.replace(/```json|```/g, '').trim()
  const s = clean.indexOf('{')
  const e = clean.lastIndexOf('}')
  if (s < 0 || e < 0) throw new Error('AIの答えがJSONではありませんでした')
  return JSON.parse(clean.slice(s, e + 1))
}

/** JSONで受け取り、形が崩れていたら理由を伝えて1回だけ再試行する */
async function askJSON(system, user, check) {
  let problem = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\n前回の答えの問題：${problem}\nルールを守って、JSONだけを答え直してください。`
    try {
      const value = await callClaude(system, prompt)
      problem = check(value)
      if (!problem) return value
    } catch (err) {
      problem = err.message
    }
  }
  throw new Error(problem || 'AIの答えを使えませんでした')
}

const JSON_ONLY = '答えはJSONだけを出力してください。前置き、説明、コードブロックは書かないでください。'

function describeInput(p) {
  return [
    `目標：${p.goal}`,
    `期限：${p.deadline}`,
    `1日に使える時間：${p.daily_minutes}分`,
    `勉強できる曜日：${p.available_weekdays.map((d) => WD[d]).join('・')}`,
    `時間帯：${p.time_slot || '決まっていない'}`,
    `決まっている忙しい予定：${p.busy_note || '特になし'}`,
    `補足：${p.notes || '特になし'}`,
  ].join('\n')
}

const ai = {
  async followup(input) {
    const v = await askJSON(
      `あなたは大学生と一緒に勉強計画を作るアシスタントです。${JSON_ONLY}`,
      `# 本人から聞いたこと\n${describeInput(input)}\n\n具体的な毎日の予定（「第3章 需要と供給」のような内容）を作るために、まだ足りない情報を1〜2問だけ質問してください。教材、範囲、いまの理解度など計画の中身に関わることだけを聞き、すでに聞いたことは聞かないでください。各質問に答えの例を2〜4個つけてください。\n\n出力の形：{"questions":[{"q":"質問文","options":["例1","例2"]}]}`,
      (v) => {
        const qs = v?.questions
        if (!Array.isArray(qs) || qs.length < 1 || qs.length > 2) return '質問は1〜2問にしてください'
        if (qs.some((q) => typeof q?.q !== 'string' || !q.q.trim())) return '質問文が空です'
        return null
      },
    )
    return v.questions.map((q) => ({ question: q.q, options: Array.isArray(q.options) ? q.options.slice(0, 4) : [] }))
  },

  /** 計画：AIには内容の並びだけを作ってもらい、日付への割り当てはアプリ側で行う */
  async generatePlan(input, days) {
    const n = Math.min(days.length, 50)
    const v = await askJSON(
      `あなたは大学生と一緒に勉強計画を作るアシスタントです。本人の生活に合った、続けられる計画を作ります。${JSON_ONLY}`,
      `# 本人から聞いたこと\n${describeInput(input)}\n\n毎日1件ずつ取り組む予定の内容を、順番どおりに${n}個作ってください。\n- 1件は${input.daily_minutes}分でできる量にする\n- 内容は、その日に何をやるかすぐわかる具体的なものにする（例：「第3章 需要と供給」「過去問 1回目」）。1件20文字以内\n- 補足の教材や範囲を使う。わからなければ一般的な進め方にする\n- 前半で範囲を一通り進め、終盤は復習や過去問にする\n\n出力の形：{"titles":["内容1","内容2"]}`,
      (v) => (Array.isArray(v?.titles) && v.titles.length > 0 && v.titles.every((t) => typeof t === 'string' && t.trim()) ? null : '内容の並びが空です'),
    )
    const titles = v.titles.slice(0, days.length)
    return days.map((date, i) => ({
      date,
      title: i < titles.length ? titles[i] : `総復習（${titles[(i - titles.length) % titles.length]}）`,
      minutes: input.daily_minutes,
      original_date: null,
    }))
  },

  async reduce(input, task) {
    const v = await askJSON(
      `あなたは大学生の勉強計画を一緒に直すアシスタントです。${JSON_ONLY}`,
      `# 計画の前提\n${describeInput(input)}\n\n${task.date} の予定「${task.title}」（${task.minutes}分）の量を減らしてください。時間を短くするか、内容を絞ってください。\n\n出力の形：{"title":"新しい内容","minutes":15}`,
      (v) => {
        if (typeof v?.title !== 'string' || !v.title.trim()) return '内容が空です'
        if (typeof v?.minutes !== 'number' || v.minutes <= 0 || v.minutes > task.minutes) return `時間は${task.minutes}分以下にしてください`
        if (v.minutes === task.minutes && v.title === task.title) return '量が減っていません'
        return null
      },
    )
    return { title: v.title.trim(), minutes: Math.round(v.minutes) }
  },

  async change(input, task, neighbors) {
    const v = await askJSON(
      `あなたは大学生の勉強計画を一緒に直すアシスタントです。${JSON_ONLY}`,
      `# 計画の前提\n${describeInput(input)}\n\n# 前後の予定\n${neighbors.map((t) => `- ${t.date}：${t.title}`).join('\n')}\n\n${task.date} の予定「${task.title}」を、別の内容にしてください。前後の予定と重ならないようにし、${task.minutes}分でできる量にしてください。\n\n出力の形：{"title":"新しい内容"}`,
      (v) => (typeof v?.title === 'string' && v.title.trim() && v.title.trim() !== task.title ? null : '別の内容になっていません'),
    )
    return v.title.trim()
  },

  async freeRequest(input, request, range) {
    const v = await askJSON(
      `あなたは大学生の勉強計画を一緒に直すアシスタントです。${JSON_ONLY}`,
      `# 計画の前提\n${describeInput(input)}\n\n計画の期間：${range.start}〜${range.end}\n本人からの頼みごと：「${request}」\n\nこの頼みごとを、次の操作に置き換えてください。\n- skip_weekdays：予定を入れない曜日（0=日〜6=土）\n- skip_dates：予定を入れない日（YYYY-MM-DD）\n- minutes：1日の時間を変えるなら分数、変えないなら null（${input.daily_minutes}分以下）\n置き換えられない頼みごとなら、すべて空にしてください。\n\n出力の形：{"skip_weekdays":[],"skip_dates":[],"minutes":null}`,
      (v) => (v && Array.isArray(v.skip_weekdays) && Array.isArray(v.skip_dates) ? null : '形が違います'),
    )
    return v
  },

  async replan(plan, win, missed, pending) {
    const list = (ts) => (ts.length ? ts.map((t) => `- ${t.date}：${t.title}（${t.minutes}分）`).join('\n') : 'なし')
    const v = await askJSON(
      `あなたは大学生の勉強計画を組み直すアシスタントです。計画が崩れて落ち込んでいる本人の代わりに、遅れた分を無理なく入れ直します。${JSON_ONLY}`,
      `# 計画の前提\n${describeInput(plan)}\n\n# 遅れた予定\n${list(missed)}\n\n# 組み直す範囲にある、まだやっていない予定\n${list(pending)}\n\n# 予定を入れてよい日\n${win.days.map((d) => `${d}（${WD[weekdayOf(d)]}）`).join('、')}\n\n# ルール\n- 遅れた予定と範囲内の予定を、「予定を入れてよい日」にだけ入れる\n- 決まっている忙しい予定と重なりそうな日は避ける\n- 1日の合計は${plan.daily_minutes}分以下\n- 入りきらないときは、まとめたり要点だけにしたりして量を減らす\n- 順番はできるだけ元のまま\n- 元の日から動かした予定は4番目に元の日付、動かしていなければ null\n\n出力の形：{"tasks":[["YYYY-MM-DD","内容",30,"元の日付またはnull"]]}`,
      (v) => {
        if (!Array.isArray(v?.tasks)) return '予定が空です'
        const tasks = v.tasks.map((r) => ({ date: r?.[0], title: r?.[1], minutes: r?.[2] }))
        return validateTasks(tasks, win.days, plan.daily_minutes)
      },
    )
    return v.tasks.map((r) => ({
      date: r[0],
      title: String(r[1]).trim(),
      minutes: Math.round(r[2]),
      original_date: r[3] && r[3] !== r[0] ? r[3] : null,
    }))
  },
}

// ---------- 状態の操作 ----------

function buildSample(today) {
  const titles = ['第1章 経済学の考え方', '第2章 需要と供給', '第2章 練習問題', '第3章 弾力性', '第3章 練習問題', '第4章 消費者の行動', '第4章 練習問題', '第5章 企業の行動', '第5章 練習問題', '第6章 完全競争市場', '第6章 練習問題', '第7章 独占', '第7章 練習問題', '第8章 市場の失敗', '第8章 練習問題', '1〜4章の復習', '5〜8章の復習', '過去問 1回目', '過去問 1回目の見直し', '過去問 2回目', '過去問 2回目の見直し', '苦手なところの総まとめ', '最終確認']
  const plan = {
    id: uid(),
    goal: '経済学の期末試験',
    deadline: addDays(today, 21),
    daily_minutes: 30,
    available_weekdays: [0, 1, 2, 3, 4, 5, 6],
    time_slot: '夜',
    busy_note: '火曜と木曜の夜はバイト',
    notes: '教科書はミクロ経済学の入門書。過去問が2回分ある',
    is_sample: true,
    created_at: nowISO(),
  }
  const tasks = daysBetween(addDays(today, -5), plan.deadline).map((date, i) => ({
    id: uid(),
    plan_id: plan.id,
    date,
    title: titles[Math.min(i, titles.length - 1)],
    minutes: 30,
    status: i <= 2 ? 'done' : i === 3 ? 'missed' : 'pending',
    original_date: null,
    updated_at: nowISO(),
  }))
  return { plans: [plan], tasks, replans: [], notified: false, day_offset: 0 }
}

function markOverdue(state, today) {
  let changed = false
  const tasks = state.tasks.map((t) => {
    if (t.status === 'pending' && t.date < today) {
      changed = true
      return { ...t, status: 'missed', auto_missed: true, updated_at: nowISO() }
    }
    return t
  })
  return changed ? { ...state, tasks } : state
}

const activePlanOf = (s) => (s.plans.length ? s.plans[s.plans.length - 1] : null)
const latestReplanOf = (s, planId) =>
  s.replans.filter((r) => r.plan_id === planId).sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))[0] || null

async function createReplan(plan, planTasks, today, cutoff) {
  const brk = detectBreak(planTasks, today, cutoff)
  if (!brk.broken) return null
  const win = buildWindow(plan, planTasks, today)
  const pending = planTasks.filter((t) => t.status === 'pending' && t.date >= win.windowStart && t.date <= win.windowEnd)
  let proposal
  try {
    proposal = await ai.replan(plan, win, brk.missedTasks, pending)
  } catch {
    proposal = fallbackReplan(plan, win, brk.missedTasks, pending)
  }
  return {
    id: uid(),
    plan_id: plan.id,
    triggered_at: nowISO(),
    missed_task_ids: brk.missedTasks.map((t) => t.id),
    proposal: { window_start: win.windowStart, window_end: win.windowEnd, days: win.days, tasks: proposal.sort(byDate) },
    confirmed_at: null,
  }
}

// ---------- 見た目 ----------
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');
.ga{--bg:#121212;--card:#1E1E1E;--line:#2E2E2E;--fg:#F2F2F2;--sub:#A0A0A0;--accent:#4DA3FF;--done:#3DDC97;--late:#F5B841;
  background:var(--bg);color:var(--fg);font-family:'Noto Sans JP',system-ui,sans-serif;font-size:18px;line-height:1.7;
  min-height:100vh;color-scheme:dark;-webkit-font-smoothing:antialiased}
.ga *{box-sizing:border-box}
.ga h1,.ga h2,.ga p,.ga ul,.ga ol,.ga dl,.ga dd{margin:0}
.ga button,.ga input{font-family:inherit}
.ga :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ga-main{max-width:480px;margin:0 auto;padding:16px 20px 220px}
.ga-bottom{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(18,18,18,.96);border-top:1px solid var(--line)}
.ga-bottom-in{max-width:480px;margin:0 auto;padding:16px 20px calc(16px + env(safe-area-inset-bottom))}
.btn{min-height:56px;border-radius:16px;padding:0 20px;font-size:18px;font-weight:700;border:0;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;gap:8px;line-height:1.3;text-align:center}
.btn:disabled{opacity:.5;cursor:default}
.btn-primary{background:var(--accent);color:#121212}
.btn-done{background:var(--done);color:#121212}
.btn-outline{background:transparent;color:var(--fg);border:2px solid var(--line)}
.btn-quiet{background:var(--card);color:var(--fg)}
.btn-link{background:transparent;color:var(--accent);padding:0 8px}
.wide{width:100%}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.row12{display:grid;grid-template-columns:1fr 2fr;gap:12px}
.card{background:var(--card);border-radius:16px;padding:20px}
.sub{color:var(--sub)} .note{font-size:16px} .bold{font-weight:700}
.t-title{font-size:24px;line-height:1.45;font-weight:700}
.t-task{font-size:28px;line-height:1.4;font-weight:900}
.t-hero{font-size:32px;line-height:1.35;font-weight:900}
.c-accent{color:var(--accent)} .c-done{color:var(--done)} .c-late{color:var(--late)}
.mt1{margin-top:4px}.mt2{margin-top:8px}.mt3{margin-top:12px}.mt4{margin-top:16px}.mt6{margin-top:24px}.mt8{margin-top:32px}.mt10{margin-top:40px}
.input{min-height:56px;width:100%;border-radius:16px;border:2px solid var(--line);background:var(--card);color:var(--fg);padding:0 16px;font-size:18px}
.input:focus{border-color:var(--accent);outline:none}
.input::placeholder{color:var(--sub)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{min-height:56px;border-radius:999px;border:2px solid var(--line);background:transparent;color:var(--fg);padding:0 16px;font-size:16px;cursor:pointer}
.choice{min-height:56px;border-radius:16px;border:2px solid var(--line);background:var(--card);color:var(--fg);font-size:18px;font-weight:700;cursor:pointer;padding:0 8px}
.choice[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#121212}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.grid7{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.nav{display:flex;flex-wrap:wrap;margin:4px -8px 0}
.navlink{min-height:56px;display:inline-flex;align-items:center;gap:6px;padding:0 8px;background:none;border:0;color:var(--sub);font-size:16px;cursor:pointer;border-radius:16px}
.back{min-height:56px;display:inline-flex;align-items:center;gap:4px;margin-left:-8px;padding:0 8px;background:none;border:0;color:var(--sub);font-size:18px;cursor:pointer;border-radius:16px}
.progress{height:8px;flex:1;background:var(--card);border-radius:999px;overflow:hidden}
.progress>div{height:100%;background:var(--accent);border-radius:999px;transition:width .2s}
.week{list-style:none;padding:0;margin:8px 0 0;display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.week li{display:flex;flex-direction:column;align-items:center;gap:4px}
.cell{height:44px;width:100%;border-radius:12px;display:flex;align-items:center;justify-content:center}
.cell-done{background:var(--done);color:#121212}
.cell-missed{border:2px solid var(--late);color:var(--late)}
.cell-none{background:var(--card);color:var(--sub)}
.cell-pending{border:2px dashed var(--sub);color:var(--sub)}
.daylist{list-style:none;padding:0;margin:0}
.daylist li+li{border-top:1px solid var(--line)}
.daybtn{width:100%;display:flex;gap:16px;align-items:flex-start;padding:16px 0;background:none;border:0;color:var(--fg);text-align:left;font-size:18px;cursor:pointer;min-height:56px}
.daybtn.moved{background:rgba(77,163,255,.12);border-radius:16px;padding:16px 12px;margin:0 -12px;width:calc(100% + 24px)}
.daydate{width:6.2em;flex-shrink:0;color:var(--sub)}
.banner{display:block;width:100%;text-align:left;background:var(--card);border:2px solid var(--late);border-radius:16px;padding:20px;color:var(--fg);font-size:18px;cursor:pointer}
.alert{border:2px solid rgba(245,184,65,.6);border-radius:16px;padding:16px}
.badge{display:inline-block;border-radius:12px;padding:4px 12px;font-size:16px;font-weight:700}
.sheet-back{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:40}
.sheet{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:480px;max-height:90vh;overflow:auto;background:var(--card);
  border-radius:24px 24px 0 0;padding:24px 24px calc(24px + env(safe-area-inset-bottom));z-index:50}
.sheet-close{position:absolute;top:12px;right:12px;width:56px;height:56px;display:flex;align-items:center;justify-content:center;background:none;border:0;color:var(--sub);cursor:pointer;border-radius:16px}
.toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:60;width:calc(100% - 32px);max-width:448px;
  background:var(--card);border:2px solid var(--line);border-radius:16px;padding:14px 20px;font-size:18px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
dl.info{display:grid;grid-template-columns:6.5em 1fr;row-gap:4px}
.swipe-wrap{position:relative;min-height:240px;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.swipe-card{position:relative;z-index:1;min-height:240px;background:var(--card);border:3px solid var(--line);border-radius:24px;
  padding:28px 24px;display:flex;flex-direction:column;justify-content:center;cursor:grab}
.swipe-card:active{cursor:grabbing}
.swipe-hint{position:absolute;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:6px;font-weight:700;font-size:18px}
.swipe-hint-left{left:8px;color:var(--late)}
.swipe-hint-right{right:8px;color:var(--done)}
@media (prefers-reduced-motion: reduce){.ga *{transition:none!important;animation:none!important}}
`

// ---------- 共通部品 ----------
function Page({ children, bottom }) {
  return (
    <>
      <main className="ga-main">{children}</main>
      {bottom && (
        <div className="ga-bottom">
          <div className="ga-bottom-in">{bottom}</div>
        </div>
      )}
    </>
  )
}

function Back({ onClick, label = '今日に戻る' }) {
  return (
    <button className="back" onClick={onClick}>
      <ChevronLeft size={24} aria-hidden />
      {label}
    </button>
  )
}

function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="sheet-back" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="t-title" style={{ paddingRight: 48 }}>{title}</h2>
        {children}
        <button className="sheet-close" onClick={onClose} aria-label="閉じる">
          <X size={24} aria-hidden />
        </button>
      </div>
    </>
  )
}

function WeekStrip({ tasks, today }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const LABEL = { done: 'できた', missed: 'ムリだった', none: '予定なし', pending: '未記録' }
  return (
    <section aria-label="直近7日の記録">
      <h2 className="note sub" style={{ fontWeight: 400 }}>直近7日</h2>
      <ol className="week">
        {days.map((d) => {
          const list = tasks.filter((t) => t.date === d)
          const s = list.length === 0 ? 'none' : list.some((t) => t.status === 'done') ? 'done' : list.some((t) => t.status === 'missed') || d < today ? 'missed' : 'pending'
          return (
            <li key={d}>
              <span className={`note ${d === today ? 'bold' : 'sub'}`}>{WD[weekdayOf(d)]}</span>
              <span className={`cell cell-${s}`}>
                {s === 'done' && <Check size={20} strokeWidth={3} aria-hidden />}
                {s === 'missed' && <X size={20} strokeWidth={3} aria-hidden />}
                {s === 'none' && <Minus size={16} aria-hidden />}
                <span className="sr">{md(d)} {LABEL[s]}</span>
              </span>
              <span className="note sub" aria-hidden>{toUTC(d).getUTCDate()}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** 日付ごとの予定リスト。日をタップして部分的に作り直せる（/plan と /replan で共通） */
function PlanEditor({ input, tasks, onChange, days, skipped, onSkippedChange, showFrom, showTo, markMoved }) {
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [request, setRequest] = useState('')

  const groups = useMemo(() => {
    const map = new Map()
    for (const t of [...tasks].sort(byDate)) {
      if (showFrom && t.date < showFrom) continue
      if (showTo && t.date > showTo) continue
      map.set(t.date, [...(map.get(t.date) || []), t])
    }
    return [...map.entries()]
  }, [tasks, showFrom, showTo])

  const usable = (extraSkip = []) => days.filter((d) => !skipped.includes(d) && !extraSkip.includes(d))

  async function run(action, date) {
    setBusy(true)
    setError(null)
    try {
      if (action === 'skip_day') {
        const next = reflow(tasks, date, usable([date]), input.daily_minutes)
        if (!next) throw new Error('この日より後に、予定を移せる日がありません')
        onSkippedChange([...skipped, date])
        onChange(next)
      } else if (action === 'reduce' || action === 'change') {
        const target = tasks.find((t) => t.date === date && t.status !== 'done')
        if (!target) throw new Error('この日に直せる予定がありません')
        let patch
        if (action === 'reduce') {
          try {
            patch = await ai.reduce(input, target)
          } catch {
            patch = { title: `${target.title.replace('（要点だけ）', '')}（要点だけ）`, minutes: Math.max(5, Math.round(target.minutes / 2 / 5) * 5) }
          }
        } else {
          const sorted = [...tasks].sort(byDate)
          const idx = sorted.indexOf(target)
          const neighbors = sorted.slice(Math.max(0, idx - 3), idx + 4).filter((t) => t !== target)
          patch = { title: await ai.change(input, target, neighbors) }
        }
        onChange(tasks.map((t) => (t === target ? { ...t, ...patch } : t)))
      }
      setSelected(null)
    } catch (e) {
      setError(e.message || '作り直せませんでした')
    } finally {
      setBusy(false)
    }
  }

  async function runFree() {
    setBusy(true)
    setError(null)
    try {
      const range = { start: days[0], end: days[days.length - 1] }
      const op = await ai.freeRequest(input, request.trim(), range)
      const skipDays = days.filter(
        (d) => (op.skip_weekdays || []).includes(weekdayOf(d)) || (op.skip_dates || []).includes(d),
      )
      const minutes = typeof op.minutes === 'number' && op.minutes > 0 && op.minutes <= input.daily_minutes ? Math.round(op.minutes) : null
      if (skipDays.length === 0 && !minutes) throw new Error('この頼みごとは反映できませんでした。日をタップして直してください')
      let next = tasks
      if (skipDays.length > 0) {
        next = reflow(tasks, skipDays[0], usable(skipDays), input.daily_minutes)
        if (!next) throw new Error('予定を移せる日がなくなってしまうため、反映できませんでした')
        onSkippedChange([...skipped, ...skipDays])
      }
      if (minutes) next = next.map((t) => (t.status === 'done' ? t : { ...t, minutes }))
      onChange(next)
      setRequest('')
    } catch (e) {
      setError(e.message || '作り直せませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <ul className="daylist">
        {groups.map(([date, list]) => {
          const moved = markMoved && list.some((t) => t.original_date && t.original_date !== t.date)
          return (
            <li key={date}>
              <button className={`daybtn${moved ? ' moved' : ''}`} onClick={() => { setError(null); setSelected(date) }}>
                <span className="daydate">{shortLabel(date)}</span>
                <span style={{ flex: 1 }}>
                  {list.map((t, i) => (
                    <span key={i} style={{ display: 'block' }}>
                      {t.title}
                      <span className="sub">　{t.minutes}分</span>
                      {markMoved && t.original_date && t.original_date !== t.date && (
                        <span className="note bold c-accent" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          {md(t.original_date)}から移動
                          <MoveRight size={16} aria-hidden />
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt6">
        <label htmlFor="plan-request" className="bold">計画全体への頼みごと</label>
        <div className="mt2" style={{ display: 'flex', gap: 8 }}>
          <input id="plan-request" className="input" value={request} onChange={(e) => setRequest(e.target.value)} placeholder="例：土曜は全部休みにしたい" />
          <button className="btn btn-outline" disabled={busy || !request.trim()} onClick={runFree}>頼む</button>
        </div>
        {busy && selected === null && <p className="note sub mt2" role="status">作り直しています</p>}
        {error && selected === null && <p className="note c-late mt2" role="alert">{error}</p>}
      </div>

      <Sheet open={selected !== null} onClose={() => !busy && setSelected(null)} title={selected ? `${shortLabel(selected)}の予定` : ''}>
        <p className="sub mt2">選ぶと、この日の分だけ作り直します。</p>
        <div className="mt4" style={{ display: 'grid', gap: 12 }}>
          {[['skip_day', 'この日はムリ'], ['reduce', '量を減らす'], ['change', '別の内容にする']].map(([a, label]) => (
            <button key={a} className="btn btn-outline wide" disabled={busy} onClick={() => run(a, selected)}>{label}</button>
          ))}
        </div>
        {busy && <p className="sub mt4" role="status">作り直しています</p>}
        {error && <p className="c-late mt4" role="alert">{error}</p>}
      </Sheet>
    </div>
  )
}

// ---------- 昨日の確認（スワイプ） ----------
function SwipeCard({ task, onDecide }) {
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(null)
  const start = useRef(null)
  const TH = 90

  function decide(status) {
    if (leaving) return
    setLeaving(status)
    setTimeout(() => onDecide(status), 220)
  }

  const x = leaving === 'done' ? 600 : leaving === 'missed' ? -600 : dx
  const dragging = start.current !== null
  return (
    <div className="swipe-wrap">
      <div className="swipe-hint swipe-hint-left" style={{ opacity: Math.min(1, Math.max(0, -dx / TH)) }} aria-hidden>
        <X size={28} strokeWidth={3} />できなかった
      </div>
      <div className="swipe-hint swipe-hint-right" style={{ opacity: Math.min(1, Math.max(0, dx / TH)) }} aria-hidden>
        できた<Check size={28} strokeWidth={3} />
      </div>
      <div
        className="swipe-card"
        tabIndex={0}
        role="group"
        aria-label={`${task.title}。右にスワイプでできた、左でできなかった。矢印キーでも選べます`}
        style={{
          transform: `translateX(${x}px) rotate(${x / 25}deg)`,
          transition: dragging ? 'none' : 'transform .22s ease',
          borderColor: dx > TH / 2 ? 'var(--done)' : dx < -TH / 2 ? 'var(--late)' : 'var(--line)',
        }}
        onPointerDown={(e) => {
          start.current = e.clientX
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (start.current !== null) setDx(e.clientX - start.current)
        }}
        onPointerUp={() => {
          start.current = null
          if (dx > TH) decide('done')
          else if (dx < -TH) decide('missed')
          else setDx(0)
        }}
        onPointerCancel={() => {
          start.current = null
          setDx(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') decide('done')
          if (e.key === 'ArrowLeft') decide('missed')
        }}
      >
        <p className="t-task">{task.title}</p>
        <p className="t-title c-accent mt2">{task.minutes}分</p>
      </div>
    </div>
  )
}

function ReviewScreen({ date, tasks, onDecide }) {
  const task = tasks[0]
  return (
    <Page
      bottom={
        <div className="row2">
          <button className="btn btn-outline" onClick={() => onDecide(task, 'missed')}>できなかった</button>
          <button className="btn btn-done" onClick={() => onDecide(task, 'done')}>できた</button>
        </div>
      }
    >
      <p className="sub mt4">昨日 {shortLabel(date)}</p>
      <h1 className="t-title mt1">この予定はできましたか？</h1>
      {tasks.length > 1 && <p className="note sub mt1">残り{tasks.length}件</p>}
      <div className="mt8">
        <SwipeCard key={task.id} task={task} onDecide={(status) => onDecide(task, status)} />
      </div>
      <p className="note sub mt6" style={{ textAlign: 'center' }}>右にスワイプでできた、左でできなかった</p>
    </Page>
  )
}

// ---------- 画面：今日 ----------
function TodayScreen({ state, persist, go, toast, today, shiftDay }) {
  const plan = activePlanOf(state)
  const [replanning, setReplanning] = useState(false)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newMinutes, setNewMinutes] = useState(30)
  const running = useRef(false)
  const failed = useRef(false)

  const tasks = plan ? state.tasks.filter((t) => t.plan_id === plan.id).sort(byDate) : []
  const replan = plan ? latestReplanOf(state, plan.id) : null
  const openReplan = replan && !replan.confirmed_at ? replan : null
  const yesterday = addDays(today, -1)
  const reviewTasks = tasks.filter((t) => t.date === yesterday && t.auto_missed)
  const reviewing = reviewTasks.length > 0

  // 計画確定の直後は、通知についての案内を一度だけ出す
  useEffect(() => {
    if (plan && !plan.is_sample && !state.notified && !reviewing) setNotifyOpen(true)
  }, [plan, state.notified, reviewing])

  // 2日以上崩れていて、未確定の組み直しがなければ、その場で組み直す
  useEffect(() => {
    if (!plan || reviewing || openReplan || running.current || failed.current) return
    const cutoff = replan?.confirmed_at ? jstDate(new Date(replan.confirmed_at)) : null
    if (!detectBreak(tasks, today, cutoff).broken) return
    running.current = true
    setReplanning(true)
    createReplan(plan, tasks, today, cutoff)
      .then((r) => r && persist((s) => ({ ...s, replans: [...s.replans, r] })))
      .catch(() => {
        failed.current = true
        toast('組み直しを作れませんでした。開き直してください')
      })
      .finally(() => {
        running.current = false
        setReplanning(false)
      })
  }, [plan, tasks, reviewing, openReplan, replan, today, persist, toast])

  function record(task, status) {
    persist((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, status, auto_missed: false, updated_at: nowISO() } : t)),
    }))
  }

  function review(task, status) {
    record(task, status)
    if (reviewTasks.length === 1) toast('昨日の分を記録しました。今日の予定です')
  }

  function addTask() {
    const title = newTitle.trim()
    if (!title) return
    const task = { id: uid(), plan_id: plan.id, date: today, title, minutes: newMinutes, status: 'pending', original_date: null, updated_at: nowISO() }
    persist((s) => ({ ...s, tasks: [...s.tasks, task] }))
    setNewTitle('')
    setAddOpen(false)
    toast('今日の予定に追加しました')
  }

  function removeSample() {
    persist((s) => ({
      ...s,
      plans: s.plans.filter((p) => p.id !== plan.id),
      tasks: s.tasks.filter((t) => t.plan_id !== plan.id),
      replans: s.replans.filter((r) => r.plan_id !== plan.id),
    }))
    toast('サンプルを消しました')
  }

  function closeNotify() {
    setNotifyOpen(false)
    if (!state.notified) persist((s) => ({ ...s, notified: true }))
  }

  if (!plan) {
    return (
      <Page bottom={<button className="btn btn-primary wide" onClick={() => go('onboarding')}>目標を入力する</button>}>
        <p className="sub mt6">{longLabel(today)}</p>
        <h1 className="t-hero mt10">まずは目標を教えてください</h1>
        <p className="sub mt4">いくつかの質問に答えると、AIと一緒に毎日の計画を作れます。崩れたときは、遅れた分をAIが組み直します。</p>
      </Page>
    )
  }

  if (reviewing) return <ReviewScreen date={yesterday} tasks={reviewTasks} onDecide={review} />

  const todays = tasks.filter((t) => t.date === today)
  const current = todays.find((t) => t.status === 'pending') || todays[todays.length - 1] || null
  const others = todays.filter((t) => t !== current)
  const todayTotal = todays.reduce((sum, t) => sum + t.minutes, 0)
  const next = tasks.find((t) => t.date > today && t.status === 'pending')
  const proposalNext = openReplan ? openReplan.proposal.tasks.find((t) => t.date === today) || openReplan.proposal.tasks[0] : null

  const bottom = current ? (
    current.status === 'pending' ? (
      <div className="row2">
        <button className="btn btn-outline" onClick={() => record(current, 'missed')}>今日はムリ</button>
        <button className="btn btn-done" onClick={() => record(current, 'done')}>できた！</button>
      </div>
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p className={current.status === 'done' ? 'bold c-done' : ''}>
          {current.status === 'done' ? '記録しました。おつかれさまです' : '明日の予定はこちらで考えておきます'}
        </p>
        <button className="btn btn-link" onClick={() => record(current, 'pending')}>取り消す</button>
      </div>
    )
  ) : null

  return (
    <Page bottom={bottom}>
      <p className="t-title">{longLabel(today)}</p>
      <p className="note sub">{plan.goal}（{md(plan.deadline)}まで）</p>

      <nav className="nav" aria-label="メニュー">
        <button className="navlink" onClick={() => go('plan')}><CalendarDays size={20} aria-hidden />計画</button>
        <button className="navlink" onClick={() => go('log')}><ClipboardList size={20} aria-hidden />検証記録</button>
        <button className="navlink" onClick={() => setNotifyOpen(true)}><Bell size={20} aria-hidden />通知</button>
      </nav>

      {plan.is_sample && (
        <div className="card mt4">
          <p>これはサンプルの計画です。自分の計画を作るときは消してください。</p>
          <button className="btn btn-outline wide mt3" onClick={removeSample}>サンプルを消す</button>
        </div>
      )}

      {replanning && <p className="alert mt4" role="status">遅れがあるので、予定を組み直しています</p>}

      {openReplan && proposalNext && (
        <button className="banner mt4" onClick={() => go('replan')}>
          <span className="bold c-late" style={{ display: 'block' }}>遅れた分を組み直しました</span>
          <span className="mt2" style={{ display: 'block' }}>
            {proposalNext.date === today ? '今日' : shortLabel(proposalNext.date)}：{proposalNext.title}
            <span className="sub">　{proposalNext.minutes}分</span>
          </span>
          <span className="bold c-accent mt3" style={{ display: 'block' }}>組み直し後の予定を見る</span>
        </button>
      )}

      <section className="mt10" aria-label="今日の予定">
        {current ? (
          <>
            <p className="sub">今日やること</p>
            <p className="t-task mt1">{current.title}</p>
            <p className="t-title c-accent mt2">{current.minutes}分</p>
            {others.length > 0 && (
              <ul className="mt4" style={{ listStyle: 'none', padding: 0 }} aria-label="今日のほかの予定">
                {others.map((t) => (
                  <li key={t.id} className="mt2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {t.status === 'done' ? <Check size={20} strokeWidth={3} className="c-done" aria-label="できた" /> : t.status === 'missed' ? <X size={20} strokeWidth={3} className="c-late" aria-label="ムリだった" /> : <Minus size={20} className="sub" aria-label="まだ" />}
                    <span className={t.status === 'pending' ? '' : 'sub'}>{t.title}<span className="sub">　{t.minutes}分</span></span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="t-task">今日は予定のない日です</p>
            {next && <p className="sub mt3">次は{shortLabel(next.date)}：{next.title}</p>}
          </>
        )}
        <button className="btn btn-outline wide mt6" onClick={() => setAddOpen(true)}>今日の予定を追加</button>
      </section>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="今日の予定を追加">
        <label htmlFor="new-title" className="bold mt4" style={{ display: 'block' }}>やること</label>
        <input id="new-title" className="input mt2" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="例：レポートの下書き" />
        <p className="bold mt4">時間</p>
        <div className="grid3 mt2">
          {[15, 30, 60].map((m) => <Choice key={m} selected={newMinutes === m} onClick={() => setNewMinutes(m)}>{m}分</Choice>)}
        </div>
        {todayTotal + newMinutes > plan.daily_minutes && (
          <p className="note c-late mt3">追加すると、今日の合計が{todayTotal + newMinutes}分になり、1日の目安（{plan.daily_minutes}分）を超えます。</p>
        )}
        <button className="btn btn-primary wide mt6" disabled={!newTitle.trim()} onClick={addTask}>追加する</button>
      </Sheet>

      <div className="mt10">
        <WeekStrip tasks={tasks} today={today} />
      </div>

      <section className="mt10" aria-label="デモ用の操作" style={{ border: '2px dashed #2E2E2E', borderRadius: 16, padding: 16 }}>
        <p className="bold">デモ用：日付を進める</p>
        <p className="note sub mt1">
          {state.day_offset ? `いまは本当の日付より${state.day_offset}日後として動いています。` : 'いまは本当の日付で動いています。'}
          記録しないまま進めると、次の日に開いたとき、できたかどうかを聞きます。
        </p>
        <div className="row2 mt3">
          <button className="btn btn-quiet" disabled={!state.day_offset} onClick={() => shiftDay('reset')}>本当の日付に戻す</button>
          <button className="btn btn-quiet" onClick={() => shiftDay(1)}>次の日へ</button>
        </div>
      </section>

      <Sheet open={notifyOpen} onClose={closeNotify} title="崩れたときの知らせ方">
        <p className="sub mt2">
          このブラウザ版では、スマホへの通知は届きません。代わりに、2日続けてできなかったあとにアプリを開くと、遅れた分を組み直した予定が一番上に出ます。
        </p>
        <p className="sub mt3">
          通知（毎晩の遅れのお知らせ、毎朝の今日の予定）まで試すには、Supabaseを使う完全版を準備してください。
        </p>
        <button className="btn btn-primary wide mt6" onClick={closeNotify}>わかった</button>
      </Sheet>
    </Page>
  )
}

// ---------- 画面：聞き取り ----------
function Choice({ selected, onClick, children }) {
  return <button type="button" className="choice" aria-pressed={selected} onClick={onClick}>{children}</button>
}

function Chips({ items, onPick }) {
  return (
    <div className="chips">
      {items.map((it) => <button key={it} type="button" className="chip" onClick={() => onPick(it)}>{it}</button>)}
    </div>
  )
}

function Q({ title, htmlFor, children }) {
  return (
    <div>
      {htmlFor ? <label htmlFor={htmlFor} className="t-title" style={{ display: 'block' }}>{title}</label> : <h1 className="t-title">{title}</h1>}
      <div className="mt6">{children}</div>
    </div>
  )
}

const STEPS = ['goal', 'deadline', 'minutes', 'weekdays', 'slot', 'busy', 'followup']

function OnboardingScreen({ go, today, setDraft }) {
  const [step, setStep] = useState('goal')
  const [input, setInput] = useState({ goal: '', deadline: '', daily_minutes: 30, available_weekdays: [0, 1, 2, 3, 4, 5, 6], time_slot: '', busy_note: '', notes: '' })
  const [questions, setQuestions] = useState(null)
  const [answers, setAnswers] = useState([])
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)
  const index = STEPS.indexOf(step)
  const update = (patch) => setInput((p) => ({ ...p, ...patch }))

  useEffect(() => {
    if (step !== 'followup' || questions) return
    setLoading('questions')
    ai.followup(input)
      .then((qs) => { setQuestions(qs); setAnswers(qs.map(() => '')) })
      .catch(() => { setQuestions([{ question: '使う教材や、勉強する範囲を教えてください', options: [] }]); setAnswers(['']) })
      .finally(() => setLoading(null))
  }, [step, questions, input])

  const canNext = {
    goal: input.goal.trim() !== '',
    deadline: input.deadline > today,
    minutes: true,
    weekdays: input.available_weekdays.length > 0,
    slot: input.time_slot !== '',
    busy: true,
    followup: questions !== null && loading === null,
  }[step]

  async function next() {
    if (step !== 'followup') return setStep(STEPS[index + 1])
    const notes = questions.map((q, i) => `${q.question}：${answers[i]?.trim() || '特になし'}`).join('\n')
    const full = { ...input, notes }
    const end = full.deadline < addDays(today, 89) ? full.deadline : addDays(today, 89)
    const days = daysBetween(today, end).filter((d) => full.available_weekdays.includes(weekdayOf(d)))
    if (days.length === 0) return setError('期限までに勉強できる日がありません。曜日か期限を見直してください')
    setLoading('plan')
    setError(null)
    try {
      const tasks = await ai.generatePlan(full, days)
      setDraft({ input: full, tasks, skipped: [] })
      go('plan')
    } catch (e) {
      setError(`計画を作れませんでした：${e.message}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <Page
      bottom={
        <div className="row12">
          <button className="btn btn-quiet" disabled={loading !== null} onClick={() => (index === 0 ? go('today') : setStep(STEPS[index - 1]))}>戻る</button>
          <button className="btn btn-primary" disabled={!canNext || loading !== null} onClick={next}>
            {step === 'followup' ? '計画の案を作る' : '次へ'}
          </button>
        </div>
      }
    >
      <Back onClick={() => go('today')} />
      <div className="mt2" style={{ display: 'flex', alignItems: 'center', gap: 12 }} aria-label={`質問 ${index + 1} / ${STEPS.length}`}>
        <div className="progress"><div style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} /></div>
        <span className="note sub">{index + 1} / {STEPS.length}</span>
      </div>

      <div className="mt8">
        {step === 'goal' && (
          <Q title="何の勉強を続けたいですか？" htmlFor="goal">
            <input id="goal" className="input" value={input.goal} onChange={(e) => update({ goal: e.target.value })} placeholder="例：経済学の期末試験" />
            <Chips items={['経済学の期末試験', 'TOEIC 600点', '簿記3級']} onPick={(v) => update({ goal: v })} />
          </Q>
        )}
        {step === 'deadline' && (
          <Q title="いつまでに終わらせたいですか？" htmlFor="deadline">
            <input id="deadline" type="date" className="input" min={addDays(today, 1)} value={input.deadline} onChange={(e) => update({ deadline: e.target.value })} />
            <Chips items={['2週間後', '1か月後', '3か月後']} onPick={(v) => update({ deadline: addDays(today, v === '2週間後' ? 14 : v === '1か月後' ? 30 : 90) })} />
            {input.deadline > today && <p className="sub mt3">{shortLabel(input.deadline)}まで</p>}
          </Q>
        )}
        {step === 'minutes' && (
          <Q title="1日に何分使えますか？">
            <div className="grid3">
              {[15, 30, 60].map((m) => <Choice key={m} selected={input.daily_minutes === m} onClick={() => update({ daily_minutes: m })}>{m}分</Choice>)}
            </div>
          </Q>
        )}
        {step === 'weekdays' && (
          <Q title="勉強できる曜日はどれですか？">
            <div className="grid7">
              {WD.map((w, i) => {
                const on = input.available_weekdays.includes(i)
                return (
                  <Choice key={w} selected={on} onClick={() => update({ available_weekdays: on ? input.available_weekdays.filter((d) => d !== i) : [...input.available_weekdays, i].sort() })}>{w}</Choice>
                )
              })}
            </div>
            <p className="note sub mt3">押すと選ぶ・外すが切り替わります</p>
          </Q>
        )}
        {step === 'slot' && (
          <Q title="勉強するのはいつごろですか？">
            <div className="grid2">
              {['朝', '昼', '夕方', '夜', '決まっていない'].map((s) => <Choice key={s} selected={input.time_slot === s} onClick={() => update({ time_slot: s })}>{s}</Choice>)}
            </div>
          </Q>
        )}
        {step === 'busy' && (
          <Q title="決まっている忙しい予定はありますか？" htmlFor="busy">
            <input id="busy" className="input" value={input.busy_note} onChange={(e) => update({ busy_note: e.target.value })} placeholder="例：火・木の夜はバイト" />
            <Chips items={['バイト', 'サークル', 'ゼミ', '部活']} onPick={(v) => update({ busy_note: input.busy_note ? `${input.busy_note}、${v}` : v })} />
            <p className="note sub mt3">なければ空のまま次へ進んでください</p>
          </Q>
        )}
        {step === 'followup' && (
          <div>
            <h1 className="t-title">あと少しだけ教えてください</h1>
            {loading === 'questions' && <p className="sub mt4" role="status">質問を考えています</p>}
            {questions?.map((q, i) => (
              <div key={i} className="mt6">
                <label htmlFor={`q${i}`} className="bold">{q.question}</label>
                <input id={`q${i}`} className="input mt2" value={answers[i] || ''} onChange={(e) => setAnswers((p) => p.map((a, j) => (j === i ? e.target.value : a)))} />
                {q.options?.length > 0 && <Chips items={q.options} onPick={(v) => setAnswers((p) => p.map((a, j) => (j === i ? v : a)))} />}
              </div>
            ))}
            {loading === 'plan' && <p className="sub mt6" role="status">AIが計画の案を作っています。30秒ほどかかります</p>}
            {error && <p className="c-late mt6" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </Page>
  )
}

// ---------- 画面：計画 ----------
function PlanScreen({ state, persist, go, toast, today, draft, setDraft }) {
  const plan = activePlanOf(state)

  if (draft) {
    const end = draft.input.deadline < addDays(today, 89) ? draft.input.deadline : addDays(today, 89)
    const days = daysBetween(today, end).filter((d) => draft.input.available_weekdays.includes(weekdayOf(d)))
    function start() {
      const newPlan = { id: uid(), ...draft.input, is_sample: false, created_at: nowISO() }
      const now = nowISO()
      const tasks = draft.tasks.map((t) => ({ id: uid(), plan_id: newPlan.id, date: t.date, title: t.title, minutes: t.minutes, status: 'pending', original_date: null, updated_at: now }))
      persist((s) => ({ ...s, plans: [...s.plans, newPlan], tasks: [...s.tasks, ...tasks], notified: false }))
      setDraft(null)
      toast('計画を保存しました')
      go('today')
    }
    return (
      <Page bottom={<button className="btn btn-primary wide" onClick={start}>この計画で始める</button>}>
        <Back onClick={() => go('onboarding')} label="聞き取りに戻る" />
        <h1 className="t-hero mt4">計画の案ができました</h1>
        <p className="sub mt3">{draft.input.goal}、{md(draft.input.deadline)}まで。気になる日をタップすると、その日だけ作り直せます。</p>
        <div className="mt6">
          <PlanEditor
            input={draft.input}
            tasks={draft.tasks}
            onChange={(tasks) => setDraft((d) => ({ ...d, tasks }))}
            days={days}
            skipped={draft.skipped}
            onSkippedChange={(skipped) => setDraft((d) => ({ ...d, skipped }))}
          />
        </div>
      </Page>
    )
  }

  if (!plan) {
    return (
      <Page bottom={<button className="btn btn-primary wide" onClick={() => go('onboarding')}>目標を入力する</button>}>
        <Back onClick={() => go('today')} />
        <h1 className="t-title mt6">まだ計画がありません</h1>
      </Page>
    )
  }

  const upcoming = state.tasks.filter((t) => t.plan_id === plan.id && t.date >= today).sort(byDate)
  return (
    <Page bottom={<button className="btn btn-outline wide" onClick={() => go('onboarding')}>計画を作り直す</button>}>
      <Back onClick={() => go('today')} />
      <h1 className="t-title mt4">{plan.goal}</h1>
      <p className="sub mt1">{md(plan.deadline)}まで、1日{plan.daily_minutes}分</p>
      {upcoming.length === 0 ? (
        <p className="sub mt8">これからの予定はありません。</p>
      ) : (
        <ul className="daylist mt6">
          {upcoming.map((t) => (
            <li key={t.id} className="daybtn" style={{ cursor: 'default' }}>
              <span className="daydate">{shortLabel(t.date)}</span>
              <span style={{ flex: 1 }}>
                {t.title}<span className="sub">　{t.minutes}分</span>
                {t.status === 'done' && <span className="bold c-done">　できた</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

// ---------- 画面：組み直し案 ----------
function ReplanScreen({ state, persist, go, toast }) {
  const plan = activePlanOf(state)
  const replan = plan ? latestReplanOf(state, plan.id) : null
  const open = replan && !replan.confirmed_at ? replan : null
  const [proposal, setProposal] = useState(open ? open.proposal.tasks : [])
  const [skipped, setSkipped] = useState([])

  if (!open) {
    return (
      <Page bottom={<button className="btn btn-primary wide" onClick={() => go('today')}>今日の予定を見る</button>}>
        <Back onClick={() => go('today')} />
        <h1 className="t-title mt6">いま組み直しが必要な遅れはありません</h1>
      </Page>
    )
  }

  const ids = new Set(open.missed_task_ids)
  const missed = state.tasks.filter((t) => ids.has(t.id)).sort(byDate)
  const missedDays = [...new Set(missed.map((t) => t.date))]
  const ws = open.proposal.window_start
  const we = open.proposal.window_end
  const showTo = addDays(ws, 6)
  const hasLater = proposal.some((t) => t.date > showTo)

  function confirm() {
    const now = nowISO()
    persist((s) => ({
      ...s,
      tasks: [
        ...s.tasks.filter((t) => !(t.plan_id === plan.id && t.status === 'pending' && t.date >= ws && t.date <= we)),
        ...proposal.map((t) => ({ id: uid(), plan_id: plan.id, date: t.date, title: t.title, minutes: t.minutes, status: 'pending', original_date: t.original_date || null, updated_at: now })),
      ],
      replans: s.replans.map((r) => (r.id === open.id ? { ...r, proposal: { ...r.proposal, tasks: proposal }, confirmed_at: now } : r)),
    }))
    toast('組み直した予定で進めます')
    go('today')
  }

  return (
    <Page bottom={<button className="btn btn-primary wide" onClick={confirm}>この予定でいく</button>}>
      <Back onClick={() => go('today')} />
      <h1 className="t-hero mt4">遅れた分を組み直しました</h1>
      <p className="sub mt3">書き直す作業はもう済んでいます。よければ下のボタンを押すだけで、これからの予定に入ります。</p>

      <section className="mt8">
        <h2 className="bold c-late" style={{ fontSize: 18 }}>遅れた分（{missedDays.length}日分）</h2>
        <ul className="mt2" style={{ listStyle: 'none', padding: 0 }}>
          {missed.map((t) => <li key={t.id}><span className="sub">{shortLabel(t.date)}　</span>{t.title}</li>)}
        </ul>
      </section>

      <section className="mt8">
        <h2 className="bold" style={{ fontSize: 18 }}>これからの7日</h2>
        <p className="note sub mt1">青い日に、遅れた分が入っています。直したい日はタップしてください。</p>
        <div className="mt2">
          <PlanEditor
            input={plan}
            tasks={proposal}
            onChange={setProposal}
            days={open.proposal.days || daysBetween(ws, we).filter((d) => plan.available_weekdays.includes(weekdayOf(d)))}
            skipped={skipped}
            onSkippedChange={setSkipped}
            showFrom={ws}
            showTo={showTo}
            markMoved
          />
        </div>
        {hasLater && <p className="note sub mt4">その後の分も、続きの日に入れてあります。</p>}
      </section>
    </Page>
  )
}

// ---------- 画面：検証記録 ----------
function LogScreen({ state, go, today }) {
  const rows = [...state.replans]
    .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))
    .map((r) => {
      const plan = state.plans.find((p) => p.id === r.plan_id)
      const tasks = state.tasks.filter((t) => t.plan_id === r.plan_id)
      return { r, plan, tasks, outcome: judge(r, tasks, today) }
    })
  const returned = rows.filter((x) => x.outcome.kind === 'returned').length
  const decided = rows.filter((x) => x.outcome.kind === 'returned' || x.outcome.kind === 'not_returned').length

  const badge = (o) => {
    if (o.kind === 'returned') return <span className="badge" style={{ background: '#3DDC97', color: '#121212' }}>戻れた（{md(o.on)}）</span>
    if (o.kind === 'not_returned') return <span className="badge c-late" style={{ border: '2px solid #F5B841' }}>戻れなかった</span>
    if (o.kind === 'in_progress') return <span className="badge" style={{ border: '2px solid #2E2E2E' }}>判定中：いま{o.streak}回連続（{md(o.until)}まで）</span>
    return <span className="badge sub" style={{ border: '2px solid #2E2E2E' }}>組み直しが未確定</span>
  }

  return (
    <Page>
      <Back onClick={() => go('today')} />
      <h1 className="t-title mt4">検証記録</h1>
      <p className="note sub mt2">組み直しを確定してから7日以内に、予定のある日で3回連続できたら「戻れた」です。</p>
      <div className="mt6" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <p className="t-hero">{returned}<span className="t-title sub"> / {decided}回</span></p>
        <p className="sub">戻れた（判定がついた回のうち）</p>
      </div>
      {rows.length === 0 ? (
        <p className="sub mt8">まだ崩れた記録はありません。</p>
      ) : (
        <ul className="mt6" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map(({ r, plan, tasks, outcome }) => {
            const ids = new Set(r.missed_task_ids)
            const days = [...new Set(tasks.filter((t) => ids.has(t.id)).map((t) => t.date))].sort()
            return (
              <li key={r.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  {badge(outcome)}
                  {plan?.is_sample && <span className="note sub">サンプル</span>}
                </div>
                <dl className="info mt3">
                  <dt className="sub">崩れた日</dt>
                  <dd>{days.length ? days.map(md).join('、') : '—'}</dd>
                  <dt className="sub">組み直し</dt>
                  <dd>{r.confirmed_at ? `${md(jstDate(new Date(r.confirmed_at)))}に確定` : 'まだ確定していません'}</dd>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}

// ---------- アプリ全体 ----------
export default function App() {
  const [state, setState] = useState(null)
  const [screen, setScreen] = useState('today')
  const [draft, setDraft] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const stateRef = useRef(null)
  const today = jstDate()

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3000)
  }, [])

  const save = useCallback(async (next) => {
    try {
      const result = await window.storage.set(KEY, JSON.stringify(next), false)
      if (!result) toast('保存できませんでした')
    } catch {
      toast('保存できませんでした')
    }
  }, [toast])

  const persist = useCallback((updater) => {
    const next = markOverdue(typeof updater === 'function' ? updater(stateRef.current) : updater, jstDate())
    stateRef.current = next
    setState(next)
    save(next)
  }, [save])

  useEffect(() => {
    ;(async () => {
      let loaded = null
      try {
        const res = await window.storage.get(KEY, false)
        if (res?.value) loaded = JSON.parse(res.value)
      } catch {
        loaded = null // まだ保存がない
      }
      DAY_OFFSET = loaded?.day_offset || 0
      const initial = markOverdue(loaded || buildSample(jstDate()), jstDate())
      stateRef.current = initial
      setState(initial)
      if (!loaded || initial !== loaded) save(initial)
    })()
  }, [save])

  const shiftDay = useCallback((delta) => {
    const nextOffset = delta === 'reset' ? 0 : (stateRef.current.day_offset || 0) + delta
    DAY_OFFSET = nextOffset
    persist((s) => ({ ...s, day_offset: nextOffset }))
    setScreen('today')
    window.scrollTo(0, 0)
  }, [persist])

  const go = useCallback((name) => {
    setScreen(name)
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="ga">
      <style>{CSS}</style>
      {!state ? (
        <Page><p className="sub mt10" role="status">読み込んでいます</p></Page>
      ) : screen === 'onboarding' ? (
        <OnboardingScreen go={go} today={today} setDraft={setDraft} />
      ) : screen === 'plan' ? (
        <PlanScreen state={state} persist={persist} go={go} toast={toast} today={today} draft={draft} setDraft={setDraft} />
      ) : screen === 'replan' ? (
        <ReplanScreen key={activePlanOf(state)?.id} state={state} persist={persist} go={go} toast={toast} />
      ) : screen === 'log' ? (
        <LogScreen state={state} go={go} today={today} />
      ) : (
        <TodayScreen key={today} state={state} persist={persist} go={go} toast={toast} today={today} shiftDay={shiftDay} />
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}
