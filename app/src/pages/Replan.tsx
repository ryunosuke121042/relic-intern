import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { BackLink, ErrorNote, Loading, Page } from '@/components/Page'
import { PlanEditor } from '@/components/PlanEditor'
import { addDays, shortLabel } from '@/lib/date'
import { toPlanInput } from '@/lib/planInput'
import { confirmReplan, getActivePlan, getLatestReplan, listPlanTasks } from '@/lib/repository'
import type { Plan, Replan as ReplanT, Task, TaskDraft } from '@/types'

export default function Replan() {
  const navigate = useNavigate()
  const [data, setData] = useState<{ plan: Plan; replan: ReplanT | null; tasks: Task[] } | null>(null)
  const [proposalTasks, setProposalTasks] = useState<TaskDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const plan = await getActivePlan()
        if (!plan) {
          navigate('/', { replace: true })
          return
        }
        const replan = await getLatestReplan(plan.id)
        // 確定済みなら、今日の画面で予定を見せる
        if (replan?.confirmed_at) {
          navigate('/', { replace: true })
          return
        }
        const tasks = await listPlanTasks(plan.id)
        setData({ plan, replan, tasks })
        if (replan) setProposalTasks(replan.proposal.tasks)
      } catch (e) {
        setError(e instanceof Error ? e.message : '読み込めませんでした')
      }
    })()
  }, [navigate])

  const missed = useMemo(() => {
    if (!data?.replan) return []
    const ids = new Set(data.replan.missed_task_ids)
    return data.tasks.filter((t) => ids.has(t.id))
  }, [data])

  if (error) return <Page><ErrorNote message={error} /></Page>
  if (!data) return <Page><Loading /></Page>

  const { plan, replan } = data
  if (!replan) {
    return (
      <Page bottom={<Button size="wide" onClick={() => navigate('/')}>今日の予定を見る</Button>}>
        <BackLink />
        <h1 className="mt-6 text-title font-bold">いま組み直しが必要な遅れはありません</h1>
      </Page>
    )
  }

  const missedDays = [...new Set(missed.map((t) => t.date))]
  const showTo = addDays(replan.proposal.window_start, 6)
  const hasLater = proposalTasks.some((t) => t.date > showTo)

  async function confirm() {
    if (!replan) return
    setSaving(true)
    try {
      await confirmReplan(replan.id, { ...replan.proposal, tasks: proposalTasks })
      toast('組み直した予定で進めます')
      navigate('/')
    } catch (e) {
      toast(e instanceof Error ? e.message : '確定できませんでした')
      setSaving(false)
    }
  }

  return (
    <Page
      bottom={
        <Button size="wide" onClick={confirm} disabled={saving}>
          {saving ? '確定しています' : 'この予定でいく'}
        </Button>
      }
    >
      <BackLink />
      <h1 className="mt-4 text-hero font-black">遅れた分を組み直しました</h1>
      <p className="mt-3 text-body text-sub">
        書き直す作業はもう済んでいます。よければ下のボタンを押すだけで、明日からの予定に入ります。
      </p>

      <section className="mt-8" aria-labelledby="missed-heading">
        <h2 id="missed-heading" className="text-body font-bold text-late">
          遅れた分（{missedDays.length}日分）
        </h2>
        <ul className="mt-2 space-y-1">
          {missed.map((t) => (
            <li key={t.id} className="text-body">
              <span className="text-sub">{shortLabel(t.date)}　</span>
              {t.title}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="next-heading">
        <h2 id="next-heading" className="text-body font-bold">
          これからの7日
        </h2>
        <p className="mt-1 text-note text-sub">青い日に、遅れた分が入っています。直したい日はタップしてください。</p>
        <div className="mt-2">
          <PlanEditor
            input={toPlanInput(plan)}
            tasks={proposalTasks}
            onChange={setProposalTasks}
            range={{ start: replan.proposal.window_start, end: replan.proposal.window_end }}
            showFrom={replan.proposal.window_start}
            showTo={showTo}
            markMoved
          />
        </div>
        {hasLater && <p className="mt-4 text-note text-sub">その後の分も、続きの日に入れてあります。</p>}
      </section>
    </Page>
  )
}
