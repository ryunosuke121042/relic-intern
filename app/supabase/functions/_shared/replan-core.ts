import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { askJSON, JSON_ONLY } from './ai.ts'
import { buildWindow, detectBreak, fallbackReplan, jstDate, type LogicTask, type ReplanWindow } from './logic.ts'
import { checkTaskList, describeDays, describeInput, normalize, TASK_SHAPE, type PlanInput, type TaskDraft } from './plan.ts'

interface PlanRow extends PlanInput {
  id: string
  user_id: string
  is_sample: boolean
}

export interface ReplanResult {
  replan: Record<string, unknown> | null
  created: boolean
  missedDays: number
  plan: PlanRow
}

function list(tasks: LogicTask[]): string {
  if (tasks.length === 0) return 'なし'
  return tasks.map((t) => `- ${t.date}：${t.title}（${t.minutes}分）`).join('\n')
}

async function aiReplan(
  plan: PlanRow,
  window: ReplanWindow,
  missed: LogicTask[],
  pending: LogicTask[],
): Promise<TaskDraft[]> {
  const system = `あなたは大学生の勉強計画を組み直すアシスタントです。計画が崩れて落ち込んでいる本人の代わりに、遅れた分を無理なく入れ直します。${JSON_ONLY}`
  const user = `# 計画の前提
${describeInput(plan)}

# 遅れた予定（できなかった分）
${list(missed)}

# 組み直す範囲にある、まだやっていない予定
${list(pending)}

# 予定を入れてよい日
${describeDays(window.days)}

# ルール
- 遅れた予定と、範囲内のまだやっていない予定を、「予定を入れてよい日」にだけ入れる
- 決まっている忙しい予定と重なりそうな日は避ける
- 1日の合計は${plan.daily_minutes}分以下にする
- 入りきらないときは、内容をまとめたり要点だけにしたりして量を減らす（titleに「要点だけ」などと書く）
- 予定の順番は、できるだけ元の順番を保つ
- 元の日から動かした予定は original_date に元の日付を入れる。動かしていない予定は null にする

# 出力の形
${TASK_SHAPE}`

  const result = await askJSON<{ tasks: TaskDraft[] }>(system, user, (v) =>
    checkTaskList(v, window.days, plan.daily_minutes),
  )
  return result.tasks
}

/**
 * 崩れていれば組み直し案を作って保存する。
 * すでに未確定の案があれば、それを返す（新しくは作らない）。
 */
export async function runReplan(db: SupabaseClient, planId: string, today = jstDate()): Promise<ReplanResult> {
  const { data: plan, error } = await db.from('plans').select('*').eq('id', planId).single()
  if (error || !plan) throw new Error('計画が見つかりません')

  const { data: latest } = await db
    .from('replans')
    .select('*')
    .eq('plan_id', planId)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest && !latest.confirmed_at) return { replan: latest, created: false, missedDays: 0, plan }

  // 予定日を過ぎても記録がない予定は「できなかった」にする
  await db.from('tasks').update({ status: 'missed' }).eq('plan_id', planId).eq('status', 'pending').lt('date', today)

  const { data: rows } = await db.from('tasks').select('*').eq('plan_id', planId).order('date')
  const tasks = (rows ?? []) as LogicTask[]
  const cutoff = latest?.confirmed_at ? jstDate(new Date(latest.confirmed_at)) : null
  const brk = detectBreak(tasks, today, cutoff)
  if (!brk.broken) return { replan: null, created: false, missedDays: 0, plan }

  const window = buildWindow(plan, tasks, today)
  const pending = tasks.filter(
    (t) => t.status === 'pending' && t.date >= window.windowStart && t.date <= window.windowEnd,
  )

  let proposalTasks: TaskDraft[]
  try {
    proposalTasks = await aiReplan(plan, window, brk.missedTasks, pending)
  } catch (e) {
    console.warn('AIでの組み直しに失敗したので、ルールで組み直します', e)
    proposalTasks = fallbackReplan(plan, window, brk.missedTasks, pending)
  }

  const { data: replan, error: insertError } = await db
    .from('replans')
    .insert({
      plan_id: planId,
      missed_task_ids: brk.missedTasks.map((t) => t.id).filter(Boolean),
      proposal: {
        window_start: window.windowStart,
        window_end: window.windowEnd,
        tasks: normalize(proposalTasks),
      },
    })
    .select('*')
    .single()
  if (insertError) throw new Error(`組み直し案を保存できませんでした：${insertError.message}`)

  return { replan, created: true, missedDays: brk.missedDays.length, plan }
}

/** ユーザーごとに一番新しい計画だけを選ぶ（サンプルは除く） */
export async function latestPlansPerUser(db: SupabaseClient): Promise<PlanRow[]> {
  const { data } = await db.from('plans').select('*').order('created_at', { ascending: false })
  const seen = new Set<string>()
  const out: PlanRow[] = []
  for (const p of (data ?? []) as PlanRow[]) {
    if (seen.has(p.user_id)) continue
    seen.add(p.user_id)
    if (!p.is_sample) out.push(p)
  }
  return out
}
