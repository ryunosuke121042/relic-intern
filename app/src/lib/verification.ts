/** 検証の判定：組み直しを確定してから7日以内に、予定のある日で3回連続できたら「戻れた」 */
import { addDays } from './logic'
import { confirmedDate } from './repository'
import type { Replan, Task } from '@/types'

export type Outcome =
  | { kind: 'unconfirmed' }
  | { kind: 'returned'; on: string }
  | { kind: 'not_returned' }
  | { kind: 'in_progress'; streak: number; until: string }

export function judge(replan: Replan, tasks: Task[], today: string): Outcome {
  const start = confirmedDate(replan)
  if (!start) return { kind: 'unconfirmed' }
  const end = addDays(start, 6)
  const last = today < end ? today : end

  const byDate = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.date < start || t.date > last) continue
    const list = byDate.get(t.date) ?? []
    list.push(t)
    byDate.set(t.date, list)
  }
  let streak = 0
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date)!
    if (list.some((t) => t.status === 'done')) {
      streak++
      if (streak >= 3) return { kind: 'returned', on: date }
    } else if (date === today && list.every((t) => t.status === 'pending')) {
      // 今日はまだ途中なので数えない
    } else {
      streak = 0
    }
  }
  if (today > end) return { kind: 'not_returned' }
  return { kind: 'in_progress', streak, until: end }
}
