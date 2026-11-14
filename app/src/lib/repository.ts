/**
 * 保存と読み込みはすべてこのファイルを通す。画面からSupabaseを直接触らない。
 */
import { supabase } from './supabase'
import { jstDate } from './logic'
import type { Plan, PlanInput, Replan, ReplanProposal, Task, TaskDraft, TaskStatus } from '@/types'

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}：${error?.message ?? '不明なエラー'}`)
}

/** 端末ごとの匿名ユーザーを用意する。新しく作ったときは true を返す */
export async function ensureUser(): Promise<{ userId: string; isNew: boolean }> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return { userId: data.session.user.id, isNew: false }
  const { data: signed, error } = await supabase.auth.signInAnonymously()
  if (error || !signed.user) fail('ユーザーを作れませんでした', error)
  return { userId: signed.user.id, isNew: true }
}

export async function getActivePlan(): Promise<Plan | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail('計画を読み込めませんでした', error)
  return (data as Plan | null) ?? null
}

export async function savePlan(input: PlanInput, tasks: TaskDraft[], isSample = false): Promise<Plan> {
  const { data: plan, error } = await supabase
    .from('plans')
    .insert({ ...input, is_sample: isSample })
    .select('*')
    .single()
  if (error || !plan) fail('計画を保存できませんでした', error)
  const rows = tasks.map((t) => ({
    plan_id: plan.id,
    date: t.date,
    title: t.title,
    minutes: t.minutes,
    status: t.status ?? 'pending',
    original_date: t.original_date,
  }))
  const { error: taskError } = await supabase.from('tasks').insert(rows)
  if (taskError) fail('予定を保存できませんでした', taskError)
  return plan as Plan
}

export async function deletePlan(planId: string): Promise<void> {
  const { error } = await supabase.from('plans').delete().eq('id', planId)
  if (error) fail('計画を消せませんでした', error)
}

/** いまの計画の予定を、日付の範囲で取る（null なら制限なし） */
export async function listTasks(from: string | null, to: string | null): Promise<Task[]> {
  const plan = await getActivePlan()
  if (!plan) return []
  return listPlanTasks(plan.id, from, to)
}

export async function listPlanTasks(planId: string, from: string | null = null, to: string | null = null): Promise<Task[]> {
  let query = supabase.from('tasks').select('*').eq('plan_id', planId)
  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)
  const { data, error } = await query.order('date').order('updated_at')
  if (error) fail('予定を読み込めませんでした', error)
  return (data ?? []) as Task[]
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId)
  if (error) fail('記録できませんでした', error)
}

/** 予定日を過ぎても記録がない予定を「できなかった」にする */
export async function markOverdueMissed(planId: string, today: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'missed' })
    .eq('plan_id', planId)
    .eq('status', 'pending')
    .lt('date', today)
  if (error) fail('記録を更新できませんでした', error)
}

export async function getLatestReplan(planId: string): Promise<Replan | null> {
  const { data, error } = await supabase
    .from('replans')
    .select('*')
    .eq('plan_id', planId)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail('組み直し案を読み込めませんでした', error)
  return (data as Replan | null) ?? null
}

/** 組み直し案を確定し、予定を置き換える（サーバー側で一度に行う） */
export async function confirmReplan(replanId: string, proposal: ReplanProposal): Promise<void> {
  const { error } = await supabase.rpc('confirm_replan', {
    p_replan_id: replanId,
    p_proposal: proposal,
  })
  if (error) fail('組み直しを確定できませんでした', error)
}

export interface ReplanLog {
  replan: Replan
  plan: Plan
  tasks: Task[]
}

/** 検証記録用：すべての組み直しと、その計画の予定 */
export async function listReplanLogs(): Promise<ReplanLog[]> {
  const { data: replans, error } = await supabase
    .from('replans')
    .select('*')
    .order('triggered_at', { ascending: false })
  if (error) fail('検証記録を読み込めませんでした', error)
  const list = (replans ?? []) as Replan[]
  if (list.length === 0) return []
  const planIds = [...new Set(list.map((r) => r.plan_id))]
  const { data: plans, error: planError } = await supabase.from('plans').select('*').in('id', planIds)
  if (planError) fail('計画を読み込めませんでした', planError)
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .in('plan_id', planIds)
    .order('date')
  if (taskError) fail('予定を読み込めませんでした', taskError)
  return list.map((replan) => ({
    replan,
    plan: (plans as Plan[]).find((p) => p.id === replan.plan_id)!,
    tasks: (tasks as Task[]).filter((t) => t.plan_id === replan.plan_id),
  }))
}

export async function savePushSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
    { onConflict: 'endpoint' },
  )
  if (error) fail('通知の登録を保存できませんでした', error)
}

export function confirmedDate(replan: Replan): string | null {
  return replan.confirmed_at ? jstDate(new Date(replan.confirmed_at)) : null
}
