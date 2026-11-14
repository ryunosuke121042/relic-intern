import { Check, Minus, X } from 'lucide-react'
import { addDays, dayNumber, weekdayLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Task } from '@/types'

type DayState = 'done' | 'missed' | 'none' | 'pending'

function stateOf(tasks: Task[], date: string, today: string): DayState {
  const list = tasks.filter((t) => t.date === date)
  if (list.length === 0) return 'none'
  if (list.some((t) => t.status === 'done')) return 'done'
  if (list.some((t) => t.status === 'missed') || date < today) return 'missed'
  return 'pending'
}

const LABEL: Record<DayState, string> = {
  done: 'できた',
  missed: 'ムリだった',
  none: '予定なし',
  pending: '未記録',
}

/** 直近7日分の記録 */
export function WeekStrip({ tasks, today }: { tasks: Task[]; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  return (
    <section aria-label="直近7日の記録">
      <h2 className="text-note text-sub">直近7日</h2>
      <ol className="mt-2 grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const s = stateOf(tasks, d, today)
          return (
            <li key={d} className="flex flex-col items-center gap-1">
              <span className={cn('text-note', d === today ? 'font-bold text-fg' : 'text-sub')}>
                {weekdayLabel(d)}
              </span>
              <span
                className={cn(
                  'flex h-11 w-full items-center justify-center rounded-xl',
                  s === 'done' && 'bg-done text-base',
                  s === 'missed' && 'border-2 border-late text-late',
                  s === 'none' && 'bg-card text-sub',
                  s === 'pending' && 'border-2 border-dashed border-sub text-sub',
                )}
              >
                {s === 'done' && <Check className="h-5 w-5" strokeWidth={3} aria-hidden />}
                {s === 'missed' && <X className="h-5 w-5" strokeWidth={3} aria-hidden />}
                {s === 'none' && <Minus className="h-4 w-4" aria-hidden />}
                <span className="sr-only">
                  {dayNumber(d)}日 {LABEL[s]}
                </span>
              </span>
              <span className="text-note text-sub" aria-hidden>
                {dayNumber(d)}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
