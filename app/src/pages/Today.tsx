import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, CalendarDays, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from '@/components/ui/use-toast'
import { ErrorNote, Loading, Page } from '@/components/Page'
import { WeekStrip } from '@/components/WeekStrip'
import { NotificationSetup } from '@/components/NotificationSetup'
import { api } from '@/lib/api'
import { longLabel, mdLabel, shortLabel, today as getToday } from '@/lib/date'
import { detectBreak } from '@/lib/logic'
import {
  confirmedDate,
  deletePlan,
  getActivePlan,
  getLatestReplan,
  listPlanTasks,
  markOverdueMissed,
  setTaskStatus,
  isLocalMode,
} from '@/lib/repository'
import type { Plan, Replan, Task, TaskStatus } from '@/types'

interface State {
  plan: Plan | null
  tasks: Task[]
  replan: Replan | null
}

export default function Today() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [replanning, setReplanning] = useState(false)
  const [setupOpen, setSetupOpen] = useState(!isLocalMode && params.get('setup') === '1')
  const today = getToday()

  const load = useCallback(async () => {
    setError(null)
    try {
      const plan = await getActivePlan()
      if (!plan) {
        setState({ plan: null, tasks: [], replan: null })
        return
      }
      await markOverdueMissed(plan.id, today)
      const tasks = await listPlanTasks(plan.id)
      const replan = await getLatestReplan(plan.id)
      setState({ plan, tasks, replan })

      // 未確定の組み直しがなく、2日以上崩れていたら、その場で組み直しを作る
      if (!replan || replan.confirmed_at) {
        const cutoff = replan ? confirmedDate(replan) : null
        if (detectBreak(tasks, today, cutoff).broken) {
          setReplanning(true)
          try {
            const res = await api.replan(plan.id)
            if (res.replan) setState({ plan, tasks, replan: res.replan })
          } catch {
            toast('組み直しを作れませんでした。少し時間をおいて開き直してください')
          } finally {
            setReplanning(false)
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込めませんでした')
    }
  }, [today])

  useEffect(() => {
    load()
  }, [load])

  function closeSetup(v: boolean) {
    setSetupOpen(v)
    if (!v && params.has('setup')) {
      params.delete('setup')
      setParams(params, { replace: true })
    }
  }

  async function record(task: Task, status: TaskStatus) {
    setSaving(true)
    try {
      await setTaskStatus(task.id, status)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '記録できませんでした')
    } finally {
      setSaving(false)
    }
  }

  async function removeSample(plan: Plan) {
    try {
      await deletePlan(plan.id)
      toast('サンプルを消しました')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'サンプルを消せませんでした')
    }
  }

  if (error) {
    return (
      <Page>
        <ErrorNote message={error} onRetry={load} />
      </Page>
    )
  }
  if (!state) return <Page><Loading /></Page>

  const { plan, tasks, replan } = state

  if (!plan) {
    return (
      <Page bottom={<Button size="wide" onClick={() => navigate('/onboarding')}>目標を入力する</Button>}>
        <p className="mt-6 text-body text-sub">{longLabel(today)}</p>
        <h1 className="mt-10 text-hero font-black">まずは目標を教えてください</h1>
        <p className="mt-4 text-body text-sub">
          {isLocalMode
            ? 'いくつかの質問に答えると、毎日の計画を作れます。崩れたときは、遅れた分を自動で組み直します。'
            : 'いくつかの質問に答えると、AIと一緒に毎日の計画を作れます。崩れたときは、遅れた分をAIが組み直します。'}
        </p>
      </Page>
    )
  }

  const todays = tasks.filter((t) => t.date === today)
  const current = todays.find((t) => t.status === 'pending') ?? todays[todays.length - 1] ?? null
  const others = todays.filter((t) => t !== current)
  const next = tasks.find((t) => t.date > today && t.status === 'pending')
  const openReplan = replan && !replan.confirmed_at ? replan : null
  const proposalNext = openReplan
    ? openReplan.proposal.tasks.find((t) => t.date === today) ?? openReplan.proposal.tasks[0]
    : null

  const bottom = current ? (
    current.status === 'pending' ? (
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" disabled={saving} onClick={() => record(current, 'missed')}>
          今日はムリ
        </Button>
        <Button variant="done" disabled={saving} onClick={() => record(current, 'done')}>
          できた！
        </Button>
      </div>
    ) : (
      <div className="flex items-center justify-between gap-3">
        <p className={current.status === 'done' ? 'text-body font-bold text-done' : 'text-body'}>
          {current.status === 'done' ? '記録しました。おつかれさまです' : '明日の予定はこちらで考えておきます'}
        </p>
        <Button variant="link" disabled={saving} onClick={() => record(current, 'pending')}>
          取り消す
        </Button>
      </div>
    )
  ) : undefined

  return (
    <Page bottom={bottom}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-title font-bold">{longLabel(today)}</p>
          <p className="text-note text-sub">
            {plan.goal}（{mdLabel(plan.deadline)}まで）
          </p>
        </div>
      </header>

      <nav aria-label="メニュー" className="-mx-2 mt-2 flex flex-wrap">
        <NavItem to="/plan" icon={<CalendarDays className="h-5 w-5" aria-hidden />} label="計画" />
        <NavItem to="/log" icon={<ClipboardList className="h-5 w-5" aria-hidden />} label="検証記録" />
        {!isLocalMode && (
        <button
          onClick={() => setSetupOpen(true)}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-2xl px-2 text-note text-sub hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60"
        >
          <Bell className="h-5 w-5" aria-hidden />
          通知
        </button>
        )}
      </nav>
      {isLocalMode && (
        <p className="mt-2 text-note text-sub">
          お試し版：記録はこの端末のブラウザにだけ保存されます。AIと通知は使えず、組み直しはルールで行います。
        </p>
      )}

      {plan.is_sample && (
        <Card className="mt-4">
          <p className="text-body">これはサンプルの計画です。自分の計画を作るときは消してください。</p>
          <Button variant="outline" size="wide" className="mt-3" onClick={() => removeSample(plan)}>
            サンプルを消す
          </Button>
        </Card>
      )}

      {replanning && (
        <p className="mt-4 rounded-2xl border-2 border-late/60 p-4 text-body" role="status">
          2日分の遅れがあるので、予定を組み直しています
        </p>
      )}

      {openReplan && proposalNext && (
        <Link
          to="/replan"
          className="mt-4 block rounded-2xl border-2 border-late bg-card p-5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60"
        >
          <p className="text-body font-bold text-late">遅れた分を組み直しました</p>
          <p className="mt-2 text-body">
            {proposalNext.date === today ? '今日' : shortLabel(proposalNext.date)}：{proposalNext.title}
            <span className="text-sub">　{proposalNext.minutes}分</span>
          </p>
          <p className="mt-3 text-body font-bold text-accent">組み直し後の予定を見る</p>
        </Link>
      )}

      <section className="mt-10" aria-label="今日の予定">
        {current ? (
          <>
            <p className="text-body text-sub">今日やること</p>
            <p className="mt-1 text-task font-black">{current.title}</p>
            <p className="mt-2 text-title font-bold text-accent">{current.minutes}分</p>
            {others.length > 0 && (
              <ul className="mt-4 space-y-1">
                {others.map((t) => (
                  <li key={t.id} className="text-body text-sub">
                    ほかに：{t.title}　{t.minutes}分
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="text-task font-black">今日は予定のない日です</p>
            {next && (
              <p className="mt-3 text-body text-sub">
                次は{shortLabel(next.date)}：{next.title}
              </p>
            )}
          </>
        )}
      </section>

      <div className="mt-10">
        <WeekStrip tasks={tasks} today={today} />
      </div>

      <NotificationSetup open={setupOpen} onOpenChange={closeSetup} />
    </Page>
  )
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-tap items-center gap-1.5 rounded-2xl px-2 text-note text-sub hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60"
    >
      {icon}
      {label}
    </Link>
  )
}
