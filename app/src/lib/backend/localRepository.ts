/**
 * Supabase なしで動かすときの保存先。データはこの端末のブラウザ（localStorage）にだけ残る。
 * 関数の形は supabaseRepository.ts と同じにしてある。
 */
import type { Plan, PlanInput, Replan, ReplanProposal, Task, TaskDraft, TaskStatus } from '@/types'
import type { ReplanLog } from '../repository'

const KEY = 'goal-app-local-v1'

interface Store {
  userId: string | null
  plans: Plan[]
  tasks: Task[]
  replans: Replan[]
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const now = () => new Date().toISOString()

export function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    /* 壊れていたら作り直す */
  }
  return { userId: null, plans: [], tasks: [], replans: [] }
}

export function save(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store))
}

const byCreatedDesc = <T extends { created_at?: string; triggered_at?: string }>(a: T, b: T) =>
  (b.created_at ?? b.triggered_at ?? '').localeCompare(a.created_at ?? a.triggered_at ?? '')

export async function ensureUser(): Promise<{ userId: string; isNew: boolean }> {
  const store = load()
  if (store.userId) return { userId: store.userId, isNew: false }
  store.userId = newId()
  save(store)
  return { userId: store.userId, isNew: true }
}

export async function getActivePlan(): Promise<Plan | null> {
  return [...load().plans].sort(byCreatedDesc)[0] ?? null
}

export async function savePlan(input: PlanInput, tasks: TaskDraft[], isSample = false): Promise<Plan> {
  const store = load()
  const plan: Plan = { ...input, id: newId(), user_id: store.userId ?? '', is_sample: isSample, created_at: now() }
  store.plans.push(plan)
  for (const t of tasks) {
    store.tasks.push({
      id: newId(),
      plan_id: plan.id,
      date: t.date,
      title: t.title,
      minutes: t.minutes,
      status: t.status ?? 'pending',
      original_date: t.original_date,
      updated_at: now(),
    })
  }
  save(store)
  return plan
}

export async function deletePlan(planId: string): Promise<void> {
  const store = load()
  store.plans = store.plans.filter((p) => p.id !== planId)
  store.tasks = store.tasks.filter((t) => t.plan_id !== planId)
  store.replans = store.replans.filter((r) => r.plan_id !== planId)
  save(store)
}

export async function listTasks(from: string | null, to: string | null): Promise<Task[]> {
  const plan = await getActivePlan()
  if (!plan) return []
  return listPlanTasks(plan.id, from, to)
}

export async function listPlanTasks(planId: string, from: string | null = null, to: string | null = null): Promise<Task[]> {
  return load()
    .tasks.filter((t) => t.plan_id === planId && (!from || t.date >= from) && (!to || t.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.updated_at.localeCompare(b.updated_at))
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const store = load()
  const task = store.tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('記録できませんでした：予定が見つかりません')
  task.status = status
  task.updated_at = now()
  save(store)
}

export async function markOverdueMissed(planId: string, today: string): Promise<void> {
  const store = load()
  for (const t of store.tasks) {
    if (t.plan_id === planId && t.status === 'pending' && t.date < today) {
      t.status = 'missed'
      t.updated_at = now()
    }
  }
  save(store)
}

export async function getLatestReplan(planId: string): Promise<Replan | null> {
  return load().replans.filter((r) => r.plan_id === planId).sort(byCreatedDesc)[0] ?? null
}

export async function insertReplan(replan: Omit<Replan, 'id' | 'triggered_at' | 'confirmed_at'>): Promise<Replan> {
  const store = load()
  const row: Replan = { ...replan, id: newId(), triggered_at: now(), confirmed_at: null }
  store.replans.push(row)
  save(store)
  return row
}

/** 組み直し案を確定し、範囲内の未完了の予定を案の予定に置き換える */
export async function confirmReplan(replanId: string, proposal: ReplanProposal): Promise<void> {
  const store = load()
  const r = store.replans.find((x) => x.id === replanId)
  if (!r) throw new Error('組み直しを確定できませんでした：組み直し案が見つかりません')
  if (r.confirmed_at) return
  store.tasks = store.tasks.filter(
    (t) =>
      !(
        t.plan_id === r.plan_id &&
        t.status === 'pending' &&
        t.date >= proposal.window_start &&
        t.date <= proposal.window_end
      ),
  )
  for (const t of proposal.tasks) {
    store.tasks.push({
      id: newId(),
      plan_id: r.plan_id,
      date: t.date,
      title: t.title,
      minutes: t.minutes,
      status: 'pending',
      original_date: t.original_date || null,
      updated_at: now(),
    })
  }
  r.proposal = proposal
  r.confirmed_at = now()
  save(store)
}

export async function listReplanLogs(): Promise<ReplanLog[]> {
  const store = load()
  return [...store.replans].sort(byCreatedDesc).flatMap((replan) => {
    const plan = store.plans.find((p) => p.id === replan.plan_id)
    if (!plan) return []
    const tasks = store.tasks.filter((t) => t.plan_id === plan.id).sort((a, b) => a.date.localeCompare(b.date))
    return [{ replan, plan, tasks }]
  })
}

export async function savePushSubscription(_sub: PushSubscription): Promise<void> {
  throw new Error('Supabaseなしの版では通知は使えません')
}
