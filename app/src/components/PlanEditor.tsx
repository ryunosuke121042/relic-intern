import { useMemo, useState } from 'react'
import { MoveRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { mdLabel, shortLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { AdjustAction, PlanInput, TaskDraft } from '@/types'

interface Props {
  input: PlanInput
  tasks: TaskDraft[]
  onChange: (tasks: TaskDraft[]) => void
  /** AIが予定を入れてよい範囲 */
  range: { start: string; end: string }
  /** 表示する範囲（省略時はすべて） */
  showFrom?: string
  showTo?: string
  /** 動いた予定に印をつける */
  markMoved?: boolean
}

const ACTIONS: { action: Exclude<AdjustAction, 'free'>; label: string }[] = [
  { action: 'skip_day', label: 'この日はムリ' },
  { action: 'reduce', label: '量を減らす' },
  { action: 'change', label: '別の内容にする' },
]

/** 日付ごとの予定リスト。日をタップして部分的に作り直せる */
export function PlanEditor({ input, tasks, onChange, range, showFrom, showTo, markMoved }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState('')

  const days = useMemo(() => {
    const map = new Map<string, TaskDraft[]>()
    for (const t of [...tasks].sort((a, b) => a.date.localeCompare(b.date))) {
      if (showFrom && t.date < showFrom) continue
      if (showTo && t.date > showTo) continue
      const list = map.get(t.date) ?? []
      list.push(t)
      map.set(t.date, list)
    }
    return [...map.entries()]
  }, [tasks, showFrom, showTo])

  async function adjust(action: AdjustAction, date?: string, text?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.adjustPlan({ input, tasks, action, date, request: text, range })
      onChange(res.tasks)
      setSelected(null)
      setRequest('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '作り直せませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {days.map(([date, list]) => {
          const moved = markMoved && list.some((t) => t.original_date && t.original_date !== t.date)
          return (
            <li key={date}>
              <button
                onClick={() => setSelected(date)}
                className={cn(
                  'flex w-full items-start gap-4 py-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60',
                  moved && '-mx-3 w-[calc(100%+1.5rem)] rounded-2xl bg-accent/10 px-3',
                )}
              >
                <span className="w-24 shrink-0 text-body text-sub">{shortLabel(date)}</span>
                <span className="flex-1">
                  {list.map((t, i) => (
                    <span key={i} className="block text-body">
                      {t.title}
                      <span className="text-sub">　{t.minutes}分</span>
                      {markMoved && t.original_date && t.original_date !== t.date && (
                        <span className="mt-1 flex items-center gap-1 text-note font-bold text-accent">
                          {mdLabel(t.original_date)}から移動
                          <MoveRight className="h-4 w-4" aria-hidden />
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

      <div className="mt-6">
        <label htmlFor="plan-request" className="text-body font-bold">
          計画全体への頼みごと
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="plan-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="例：土曜は全部休みにしたい"
          />
          <Button
            variant="outline"
            disabled={busy || request.trim() === ''}
            onClick={() => adjust('free', undefined, request.trim())}
          >
            頼む
          </Button>
        </div>
        {busy && selected === null && <p className="mt-2 text-note text-sub">作り直しています</p>}
        {error && selected === null && <p className="mt-2 text-note text-late">{error}</p>}
      </div>

      <Dialog open={selected !== null} onOpenChange={(v) => !v && !busy && setSelected(null)}>
        <DialogContent>
          <DialogTitle>{selected && shortLabel(selected)}の予定</DialogTitle>
          <DialogDescription>選ぶと、この日の分だけAIが作り直します。</DialogDescription>
          <div className="mt-5 grid gap-3">
            {ACTIONS.map(({ action, label }) => (
              <Button
                key={action}
                variant="outline"
                size="wide"
                disabled={busy}
                onClick={() => selected && adjust(action, selected)}
              >
                {label}
              </Button>
            ))}
          </div>
          {busy && <p className="mt-4 text-body text-sub" role="status">作り直しています</p>}
          {error && <p className="mt-4 text-body text-late" role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </div>
  )
}
