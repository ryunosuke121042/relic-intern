/** Edge Functions（AI）の呼び出し。APIキーはサーバー側にだけ置く */
import { supabase } from '../supabase'
import type { AdjustAction, FollowupQuestion, PlanInput, Replan, TaskDraft } from '@/types'

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx) {
        const detail = await ctx.json()
        if (detail?.error) message = detail.error
      }
    } catch {
      /* 本文が読めなければ元のメッセージを使う */
    }
    throw new Error(message)
  }
  return data as T
}

export const api = {
  followupQuestions(input: Partial<PlanInput>) {
    return invoke<{ questions: FollowupQuestion[] }>('followup-questions', { input })
  },
  generatePlan(input: PlanInput, startDate: string) {
    return invoke<{ tasks: TaskDraft[] }>('generate-plan', { input, start_date: startDate })
  },
  adjustPlan(args: {
    input: PlanInput
    tasks: TaskDraft[]
    action: AdjustAction
    date?: string
    request?: string
    range: { start: string; end: string }
  }) {
    return invoke<{ tasks: TaskDraft[] }>('adjust-plan', args)
  },
  replan(planId: string) {
    return invoke<{ replan: Replan | null }>('replan', { plan_id: planId })
  },
}
