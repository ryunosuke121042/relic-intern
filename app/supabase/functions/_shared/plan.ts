import { addDays, daysBetween, validateTasks, weekdayOf } from './logic.ts'

export interface PlanInput {
  goal: string
  deadline: string
  daily_minutes: number
  available_weekdays: number[]
  time_slot: string
  busy_note: string
  notes: string
}

export interface TaskDraft {
  date: string
  title: string
  minutes: number
  original_date: string | null
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** 範囲内で予定を入れてよい日（曜日で絞る） */
export function allowedDays(input: PlanInput, start: string, end: string): string[] {
  return daysBetween(start, end).filter((d) => input.available_weekdays.includes(weekdayOf(d)))
}

/** AIに渡す日付一覧（曜日つき） */
export function describeDays(days: string[]): string {
  return days.map((d) => `${d}（${WEEKDAYS[weekdayOf(d)]}）`).join('、')
}

export function describeInput(input: PlanInput): string {
  return [
    `目標：${input.goal}`,
    `期限：${input.deadline}`,
    `1日に使える時間：${input.daily_minutes}分`,
    `勉強できる曜日：${input.available_weekdays.map((d) => WEEKDAYS[d]).join('・')}`,
    `勉強する時間帯：${input.time_slot || '決まっていない'}`,
    `決まっている忙しい予定：${input.busy_note || '特になし'}`,
    `補足：${input.notes || '特になし'}`,
  ].join('\n')
}

/** AIの答えを整え、ルールを守っているか確かめる */
export function checkTaskList(
  value: unknown,
  days: string[],
  dailyMinutes: number,
  extra?: (tasks: TaskDraft[]) => string | null,
): string | null {
  const tasks = (value as { tasks?: unknown })?.tasks
  const problem = validateTasks(tasks, days, dailyMinutes)
  if (problem) return problem
  return extra ? extra(tasks as TaskDraft[]) : null
}

export function normalize(tasks: TaskDraft[]): TaskDraft[] {
  return tasks
    .map((t) => ({
      date: t.date,
      title: String(t.title).trim(),
      minutes: Math.round(t.minutes),
      original_date: t.original_date && t.original_date !== t.date ? t.original_date : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export { addDays }

export const TASK_SHAPE =
  '{"tasks":[{"date":"YYYY-MM-DD","title":"やること（例：第3章 需要と供給）","minutes":30,"original_date":null}]}'
