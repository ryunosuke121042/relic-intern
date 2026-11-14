import { useEffect, useState } from 'react'
import { BackLink, ErrorNote, Loading, Page } from '@/components/Page'
import { Card } from '@/components/ui/card'
import { mdLabel, today as getToday } from '@/lib/date'
import { confirmedDate, listReplanLogs, type ReplanLog } from '@/lib/repository'
import { judge, type Outcome } from '@/lib/verification'
import { cn } from '@/lib/utils'

export default function Log() {
  const today = getToday()
  const [logs, setLogs] = useState<ReplanLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listReplanLogs()
      .then(setLogs)
      .catch((e) => setError(e instanceof Error ? e.message : '読み込めませんでした'))
  }, [])

  if (error) return <Page><ErrorNote message={error} /></Page>
  if (!logs) return <Page><Loading /></Page>

  const rows = logs.map((log) => ({ log, outcome: judge(log.replan, log.tasks, today) }))
  const returned = rows.filter((r) => r.outcome.kind === 'returned').length
  const decided = rows.filter((r) => r.outcome.kind === 'returned' || r.outcome.kind === 'not_returned').length

  return (
    <Page>
      <BackLink />
      <h1 className="mt-4 text-title font-bold">検証記録</h1>
      <p className="mt-2 text-note text-sub">
        組み直しを確定してから7日以内に、予定のある日で3回連続できたら「戻れた」です。
      </p>

      <div className="mt-6 flex items-baseline gap-3">
        <p className="text-hero font-black">
          {returned}
          <span className="text-title text-sub"> / {decided}回</span>
        </p>
        <p className="text-body text-sub">戻れた（判定がついた回のうち）</p>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-body text-sub">まだ崩れた記録はありません。</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map(({ log, outcome }) => {
            const ids = new Set(log.replan.missed_task_ids)
            const days = [...new Set(log.tasks.filter((t) => ids.has(t.id)).map((t) => t.date))]
            const confirmed = confirmedDate(log.replan)
            return (
              <li key={log.replan.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <OutcomeBadge outcome={outcome} />
                    {log.plan?.is_sample && <span className="text-note text-sub">サンプル</span>}
                  </div>
                  <dl className="mt-3 grid grid-cols-[7em_1fr] gap-y-1 text-body">
                    <dt className="text-sub">崩れた日</dt>
                    <dd>{days.length > 0 ? days.map(mdLabel).join('、') : '—'}</dd>
                    <dt className="text-sub">組み直し</dt>
                    <dd>{confirmed ? `${mdLabel(confirmed)}に確定` : 'まだ確定していません'}</dd>
                  </dl>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const map = {
    returned: { text: `戻れた（${outcome.kind === 'returned' ? mdLabel(outcome.on) : ''}）`, cls: 'bg-done text-base' },
    not_returned: { text: '戻れなかった', cls: 'border-2 border-late text-late' },
    in_progress: {
      text:
        outcome.kind === 'in_progress'
          ? `判定中：いま${outcome.streak}回連続（${mdLabel(outcome.until)}まで）`
          : '',
      cls: 'border-2 border-line text-fg',
    },
    unconfirmed: { text: '組み直しが未確定', cls: 'border-2 border-line text-sub' },
  } as const
  const { text, cls } = map[outcome.kind]
  return <span className={cn('inline-block rounded-xl px-3 py-1 text-note font-bold', cls)}>{text}</span>
}
