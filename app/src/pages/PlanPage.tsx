import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { BackLink, ErrorNote, Loading, Page } from '@/components/Page'
import { PlanEditor } from '@/components/PlanEditor'
import { mdLabel, shortLabel, today as getToday } from '@/lib/date'
import { clearDraft, loadDraft, saveDraft, type PlanDraft } from '@/lib/draft'
import { getActivePlan, listPlanTasks, savePlan } from '@/lib/repository'
import type { Plan, Task } from '@/types'

export default function PlanPage() {
  const [draft, setDraft] = useState<PlanDraft | null>(() => loadDraft())
  if (draft) return <DraftView draft={draft} setDraft={setDraft} />
  return <CurrentPlanView />
}

/** AIが作った案を一緒に直して確定する */
function DraftView({ draft, setDraft }: { draft: PlanDraft; setDraft: (d: PlanDraft) => void }) {
  const navigate = useNavigate()
  const today = getToday()
  const [saving, setSaving] = useState(false)

  async function start() {
    setSaving(true)
    try {
      await savePlan(draft.input, draft.tasks)
      clearDraft()
      toast('計画を保存しました')
      navigate('/?setup=1')
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存できませんでした')
      setSaving(false)
    }
  }

  return (
    <Page
      bottom={
        <Button size="wide" onClick={start} disabled={saving}>
          {saving ? '保存しています' : 'この計画で始める'}
        </Button>
      }
    >
      <BackLink to="/onboarding" label="聞き取りに戻る" />
      <h1 className="mt-4 text-hero font-black">計画の案ができました</h1>
      <p className="mt-3 text-body text-sub">
        {draft.input.goal}、{mdLabel(draft.input.deadline)}まで。気になる日をタップすると、その日だけ作り直せます。
      </p>
      <div className="mt-6">
        <PlanEditor
          input={draft.input}
          tasks={draft.tasks}
          range={{ start: today, end: draft.input.deadline }}
          onChange={(tasks) => {
            const next = { ...draft, tasks }
            saveDraft(next)
            setDraft(next)
          }}
        />
      </div>
    </Page>
  )
}

/** 確定済みの計画を見る */
function CurrentPlanView() {
  const navigate = useNavigate()
  const today = getToday()
  const [data, setData] = useState<{ plan: Plan; tasks: Task[] } | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const plan = await getActivePlan()
        if (!plan) {
          navigate('/onboarding', { replace: true })
          return
        }
        const tasks = await listPlanTasks(plan.id, today)
        setData({ plan, tasks })
      } catch (e) {
        setError(e instanceof Error ? e.message : '読み込めませんでした')
      }
    })()
  }, [navigate, today])

  if (error) return <Page><ErrorNote message={error} /></Page>
  if (!data) return <Page><Loading /></Page>

  return (
    <Page
      bottom={
        <Button variant="outline" size="wide" onClick={() => navigate('/onboarding')}>
          計画を作り直す
        </Button>
      }
    >
      <BackLink />
      <h1 className="mt-4 text-title font-bold">{data.plan.goal}</h1>
      <p className="mt-1 text-body text-sub">
        {mdLabel(data.plan.deadline)}まで、1日{data.plan.daily_minutes}分
      </p>
      {data.tasks.length === 0 ? (
        <p className="mt-8 text-body text-sub">これからの予定はありません。</p>
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {data.tasks.map((t) => (
            <li key={t.id} className="flex gap-4 py-4">
              <span className="w-24 shrink-0 text-body text-sub">{shortLabel(t.date)}</span>
              <span className="flex-1 text-body">
                {t.title}
                <span className="text-sub">　{t.minutes}分</span>
                {t.status === 'done' && <span className="ml-2 font-bold text-done">できた</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
