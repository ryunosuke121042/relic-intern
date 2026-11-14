/**
 * Supabase なしで動かすときの計画づくり・組み直し。AIは使わず、ルールで作る。
 * 関数の形は supabaseApi.ts と同じにしてある。
 */
import {
  addDays,
  buildWindow,
  daysBetween,
  detectBreak,
  fallbackReplan,
  jstDate,
  weekdayOf,
  type LogicTask,
} from '../logic'
import { getLatestReplan, insertReplan, listPlanTasks, load, markOverdueMissed } from './localRepository'
import type { AdjustAction, FollowupQuestion, PlanInput, Replan, TaskDraft } from '@/types'

const SUFFIX = '（要点だけ）'
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function normalize(tasks: TaskDraft[]): TaskDraft[] {
  return tasks
    .map((t) => ({
      date: t.date,
      title: String(t.title).trim(),
      minutes: Math.round(t.minutes),
      original_date: t.original_date && t.original_date !== t.date ? t.original_date : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function allowedDays(input: PlanInput, start: string, end: string): string[] {
  return daysBetween(start, end).filter((d) => input.available_weekdays.includes(weekdayOf(d)))
}

/** 前半で範囲を進め、後半は復習、最後は過去問・総まとめにする */
function planTitles(goal: string, count: number): string[] {
  if (count === 1) return ['総まとめ']
  if (count === 2) return [`${goal}：全体をひととおり`, '総まとめ']
  const study = Math.max(1, Math.round(count * 0.6))
  const review = Math.max(1, Math.round(count * 0.25))
  const finish = count - study - review
  const titles: string[] = []
  for (let i = 1; i <= study; i++) titles.push(`${goal}：範囲を進める（${i}/${study}）`)
  for (let i = 1; i <= review; i++) titles.push(review === 1 ? 'ここまでの復習' : `ここまでの復習（${i}/${review}）`)
  for (let i = 1; i <= finish; i++) titles.push(i === finish ? '最終確認' : `過去問・総まとめ（${i}/${finish - 1}）`)
  return titles
}

const ALTERNATIVES = ['練習問題', '苦手なところの見直し', 'ノートのまとめ', 'ここまでの復習', '用語の確認']

function sumOn(tasks: TaskDraft[], date: string) {
  return tasks.filter((t) => t.date === date).reduce((s, t) => s + t.minutes, 0)
}

/** date の予定を外し、空いている近くの日（なければ次の予定のある日にまとめて）へ移す */
function moveOff(input: PlanInput, tasks: TaskDraft[], dates: string[], range: { start: string; end: string }): TaskDraft[] {
  const blocked = new Set(dates)
  const moving = tasks.filter((t) => blocked.has(t.date))
  let rest = tasks.filter((t) => !blocked.has(t.date))
  const usable = new Set(allowedDays(input, range.start, range.end))
  for (const t of rest) if (t.date >= range.start && t.date <= range.end) usable.add(t.date)
  const candidates = [...usable].filter((d) => !blocked.has(d)).sort()
  if (candidates.length === 0) throw new Error('予定を移せる日がありません')

  for (const t of moving) {
    const from = t.original_date ?? t.date
    const free =
      candidates.find((d) => d > t.date && sumOn(rest, d) === 0) ??
      [...candidates].reverse().find((d) => d < t.date && sumOn(rest, d) === 0)
    if (free) {
      rest.push({ ...t, date: free, original_date: from, minutes: Math.min(t.minutes, input.daily_minutes) })
      continue
    }
    // 空きがなければ、近い日の予定と「要点だけ」にまとめる
    const target = candidates.find((d) => d > t.date) ?? candidates[candidates.length - 1]
    const host = rest.find((x) => x.date === target)
    if (!host) {
      rest.push({ ...t, date: target, original_date: from })
      continue
    }
    rest = rest.map((x) =>
      x === host
        ? {
            ...x,
            title:
              t.date < x.date
                ? `${t.title.replace(SUFFIX, '')}／${x.title.replace(SUFFIX, '')}${SUFFIX}`
                : `${x.title.replace(SUFFIX, '')}／${t.title.replace(SUFFIX, '')}${SUFFIX}`,
            minutes: Math.min(input.daily_minutes, Math.max(x.minutes, t.minutes)),
          }
        : x,
    )
  }
  return rest
}

/** 自由入力のうち「土曜は休み」「火曜と木曜はムリ」のような頼みごとだけ読み取る */
function parseWeekdays(request: string): number[] {
  if (!/(休|ムリ|むり|無理|空け|なし|入れない)/.test(request)) return []
  if (/土日|週末/.test(request)) return [0, 6]
  const found = new Set<number>()
  for (const m of request.matchAll(/([日月火水木金土])曜/g)) found.add(WEEKDAYS.indexOf(m[1]))
  return [...found]
}

export const api = {
  async followupQuestions(_input: Partial<PlanInput>): Promise<{ questions: FollowupQuestion[] }> {
    return {
      questions: [
        { question: '使う教材や、勉強する範囲を教えてください', options: ['教科書の1〜8章', '授業のスライド', '問題集1冊'] },
        { question: 'いまの理解度はどのくらいですか？', options: ['ほぼゼロから', '半分くらい', 'ひととおりわかる'] },
      ],
    }
  },

  async generatePlan(input: PlanInput, startDate: string): Promise<{ tasks: TaskDraft[] }> {
    const cap = addDays(startDate, 89)
    const end = input.deadline < cap ? input.deadline : cap
    const days = allowedDays(input, startDate, end)
    if (days.length === 0) throw new Error('期限までに勉強できる日がありません')
    const titles = planTitles(input.goal.trim() || '勉強', days.length)
    return {
      tasks: days.map((date, i) => ({ date, title: titles[i], minutes: input.daily_minutes, original_date: null })),
    }
  },

  async adjustPlan(args: {
    input: PlanInput
    tasks: TaskDraft[]
    action: AdjustAction
    date?: string
    request?: string
    range: { start: string; end: string }
  }): Promise<{ tasks: TaskDraft[] }> {
    const { input, tasks, action, date, range } = args
    if (action !== 'free' && !date) throw new Error('日付が指定されていません')

    if (action === 'skip_day') return { tasks: normalize(moveOff(input, tasks, [date!], range)) }

    if (action === 'reduce') {
      return {
        tasks: normalize(
          tasks.map((t) => {
            if (t.date !== date) return t
            const minutes = Math.max(5, Math.round(t.minutes / 2 / 5) * 5)
            const title = t.title.includes(SUFFIX) ? t.title : `${t.title}${SUFFIX}`
            return { ...t, minutes: minutes < t.minutes ? minutes : t.minutes, title }
          }),
        ),
      }
    }

    if (action === 'change') {
      const near = tasks.filter((t) => t.date !== date && t.date >= addDays(date!, -3) && t.date <= addDays(date!, 3))
      const nearby = new Set(near.map((t) => t.title))
      return {
        tasks: normalize(
          tasks.map((t) => {
            if (t.date !== date) return t
            const next = ALTERNATIVES.find((a) => a !== t.title && !nearby.has(a)) ?? ALTERNATIVES.find((a) => a !== t.title)!
            return { ...t, title: next }
          }),
        ),
      }
    }

    // free
    const weekdays = parseWeekdays(args.request ?? '')
    if (weekdays.length === 0) {
      throw new Error('Supabaseなしの版では「土曜は休み」のような曜日の頼みごとだけ使えます。ほかは日をタップして直してください')
    }
    const blocked = tasks.map((t) => t.date).filter((d) => weekdays.includes(weekdayOf(d)))
    const narrowed = { ...input, available_weekdays: input.available_weekdays.filter((w) => !weekdays.includes(w)) }
    if (narrowed.available_weekdays.length === 0) throw new Error('勉強できる曜日がなくなってしまいます')
    return { tasks: normalize(moveOff(narrowed, tasks, [...new Set(blocked)], range)) }
  },

  /** 崩れていれば、ルールで組み直し案を作って保存する（未確定の案があればそれを返す） */
  async replan(planId: string): Promise<{ replan: Replan | null }> {
    const today = jstDate()
    const plan = load().plans.find((p) => p.id === planId)
    if (!plan) throw new Error('計画が見つかりません')

    const latest = await getLatestReplan(planId)
    if (latest && !latest.confirmed_at) return { replan: latest }

    await markOverdueMissed(planId, today)
    const tasks = (await listPlanTasks(planId)) as LogicTask[]
    const cutoff = latest?.confirmed_at ? jstDate(new Date(latest.confirmed_at)) : null
    const brk = detectBreak(tasks, today, cutoff)
    if (!brk.broken) return { replan: null }

    const window = buildWindow(plan, tasks, today)
    const pending = tasks.filter(
      (t) => t.status === 'pending' && t.date >= window.windowStart && t.date <= window.windowEnd,
    )
    const proposal = fallbackReplan(plan, window, brk.missedTasks, pending)
    const replan = await insertReplan({
      plan_id: planId,
      missed_task_ids: brk.missedTasks.map((t) => t.id).filter((id): id is string => Boolean(id)),
      proposal: { window_start: window.windowStart, window_end: window.windowEnd, tasks: normalize(proposal) },
    })
    return { replan }
  },
}
