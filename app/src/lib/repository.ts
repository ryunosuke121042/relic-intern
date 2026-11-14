/**
 * 保存と読み込みはすべてこのファイルを通す。画面から保存先を直接触らない。
 * Supabase の設定があれば Supabase に、なければこの端末（localStorage）に保存する。
 */
import { isConfigured } from './supabase'
import { jstDate } from './logic'
import * as remote from './backend/supabaseRepository'
import * as local from './backend/localRepository'
import type { Plan, Replan, Task } from '@/types'

export interface ReplanLog {
  replan: Replan
  plan: Plan
  tasks: Task[]
}

/** true のときは Supabase なしで、この端末だけで動いている */
export const isLocalMode = !isConfigured

const impl: typeof remote = isConfigured ? remote : local

export const ensureUser = impl.ensureUser
export const getActivePlan = impl.getActivePlan
export const savePlan = impl.savePlan
export const deletePlan = impl.deletePlan
export const listTasks = impl.listTasks
export const listPlanTasks = impl.listPlanTasks
export const setTaskStatus = impl.setTaskStatus
export const markOverdueMissed = impl.markOverdueMissed
export const getLatestReplan = impl.getLatestReplan
export const confirmReplan = impl.confirmReplan
export const listReplanLogs = impl.listReplanLogs
export const savePushSubscription = impl.savePushSubscription

export function confirmedDate(replan: Replan): string | null {
  return replan.confirmed_at ? jstDate(new Date(replan.confirmed_at)) : null
}
