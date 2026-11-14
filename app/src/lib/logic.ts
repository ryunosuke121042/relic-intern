/**
 * 崩れの判定と、ルールによる組み直し。
 * このファイルは supabase/functions/_shared/logic.ts と同じ内容です。
 * 片方を直したら、もう片方にもコピーしてください。
 * 日付はすべて 'YYYY-MM-DD' の文字列で扱います（Asia/Tokyoの日付）。
 */

export type LogicStatus = 'pending' | 'done' | 'missed'

export interface LogicTask {
  id?: string
  date: string
  title: string
  minutes: number
  status?: LogicStatus
  original_date: string | null
}

export interface LogicPlan {
  deadline: string
  daily_minutes: number
  available_weekdays: number[]
}

export interface ReplanWindow {
  windowStart: string
  windowEnd: string
  days: string[]
}

// ---------- 日付ヘルパー（UTCで計算してずれを防ぐ） ----------
export function toUTC(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

export function fromUTC(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

export function addDays(d: string, n: number): string {
  const dt = toUTC(d)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUTC(dt)
}

export function weekdayOf(d: string): number {
  return toUTC(d).getUTCDay()
}

export function jstDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

// ---------- 崩れの判定 ----------
/**
 * 予定のある日が2日連続で「できなかった」なら崩れたと判定する。
 * - 過去の日：doneが1つもなければ「できなかった日」
 * - 今日：「今日はムリ」を押したときだけ「できなかった日」。未記録の今日は判定に入れない
 * - cutoff（直前の組み直しを確定した日）より前の日は見ない
 */
export function detectBreak(
  tasks: LogicTask[],
  today: string,
  cutoff: string | null,
): { broken: boolean; missedDays: string[]; missedTasks: LogicTask[] } {
  const relevant = tasks.filter((t) => t.date <= today && (!cutoff || t.date >= cutoff))
  const byDate = new Map<string, LogicTask[]>()
  for (const t of relevant) {
    const list = byDate.get(t.date) ?? []
    list.push(t)
    byDate.set(t.date, list)
  }
  const dates = [...byDate.keys()].sort().reverse()

  const missedDays: string[] = []
  const missedTasks: LogicTask[] = []
  for (const date of dates) {
    const list = byDate.get(date)!
    const anyDone = list.some((t) => t.status === 'done')
    if (anyDone) break
    if (date === today) {
      const anyMissed = list.some((t) => t.status === 'missed')
      if (!anyMissed) continue // 今日はまだ終わっていない
    }
    missedDays.push(date)
    missedTasks.push(...list.filter((t) => t.status !== 'done'))
  }
  missedDays.reverse()
  missedTasks.sort((a, b) => a.date.localeCompare(b.date))
  return { broken: missedDays.length >= 2, missedDays, missedTasks }
}

// ---------- 組み直しの範囲 ----------
/**
 * 今日（今日の記録があれば明日）から最大14日、期限までを組み直しの範囲にする。
 * 予定可能な曜日で、すでに「できた」日を除いた日が入れ先になる。
 */
export function buildWindow(plan: LogicPlan, tasks: LogicTask[], today: string): ReplanWindow {
  const todayRecorded = tasks.some(
    (t) => t.date === today && (t.status === 'done' || t.status === 'missed'),
  )
  const windowStart = todayRecorded ? addDays(today, 1) : today
  const cap = addDays(windowStart, 13)
  let windowEnd = plan.deadline < cap ? plan.deadline : cap
  if (windowEnd < windowStart) windowEnd = addDays(windowStart, 6) // 期限を過ぎていても1週間分は組む

  const doneDates = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.date))
  let days = daysBetween(windowStart, windowEnd).filter(
    (d) => plan.available_weekdays.includes(weekdayOf(d)) && !doneDates.has(d),
  )
  if (days.length === 0) days = [windowStart]
  return { windowStart, windowEnd, days }
}

// ---------- ルールによる組み直し（AIが失敗したときの予備） ----------
/**
 * 遅れた予定 → 範囲内の未完了の予定 の順に並べ、入れ先の日へ1日1件ずつ順番に詰める。
 * 入りきらないときは、後ろから隣どうしの予定を「要点だけ」として1日にまとめる
 * （順番は保ち、1日の時間は増やさない）。
 */
export function fallbackReplan(
  plan: LogicPlan,
  window: ReplanWindow,
  missedTasks: LogicTask[],
  pendingInWindow: LogicTask[],
): LogicTask[] {
  const SUFFIX = '（要点だけ）'
  const items = [
    ...missedTasks.map((t) => ({ title: t.title, minutes: t.minutes, from: t.date, original_date: t.original_date })),
    ...[...pendingInWindow]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({ title: t.title, minutes: t.minutes, from: t.date, original_date: t.original_date })),
  ]
  const slots = window.days.length
  let i = items.length - 2
  while (items.length > slots && items.length > 1) {
    if (i < 0) i = items.length - 2
    const a = items[i]
    const b = items[i + 1]
    items.splice(i, 2, {
      title: `${a.title.replace(SUFFIX, '')}／${b.title.replace(SUFFIX, '')}${SUFFIX}`,
      minutes: Math.max(a.minutes, b.minutes),
      from: a.from,
      original_date: a.original_date,
    })
    i -= 2
  }
  return items.map((item, idx) => {
    const day = window.days[idx]
    return {
      date: day,
      title: item.title,
      minutes: Math.min(item.minutes, plan.daily_minutes),
      original_date: item.from !== day ? (item.original_date ?? item.from) : item.original_date,
    }
  })
}

// ---------- 予定案のチェック ----------
/** 入れてよい日・1日の上限時間を守っているか確かめる。問題があれば理由を返す */
export function validateTasks(
  tasks: unknown,
  allowedDays: string[],
  dailyMinutes: number,
): string | null {
  if (!Array.isArray(tasks) || tasks.length === 0) return '予定が空です'
  const allowed = new Set(allowedDays)
  const sum = new Map<string, number>()
  for (const t of tasks as Record<string, unknown>[]) {
    if (typeof t.date !== 'string' || !allowed.has(t.date))
      return `入れられない日があります: ${String(t.date)}`
    if (typeof t.title !== 'string' || t.title.trim() === '') return '内容が空の予定があります'
    if (typeof t.minutes !== 'number' || !Number.isFinite(t.minutes) || t.minutes <= 0)
      return '時間が正しくない予定があります'
    sum.set(t.date, (sum.get(t.date) ?? 0) + t.minutes)
  }
  for (const [date, total] of sum) {
    if (total > dailyMinutes) return `${date} が1日の上限（${dailyMinutes}分）を超えています`
  }
  return null
}
