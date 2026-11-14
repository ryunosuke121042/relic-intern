import type { Plan, PlanInput } from '@/types'

export function toPlanInput(plan: Plan): PlanInput {
  return {
    goal: plan.goal,
    deadline: plan.deadline,
    daily_minutes: plan.daily_minutes,
    available_weekdays: plan.available_weekdays,
    time_slot: plan.time_slot,
    busy_note: plan.busy_note,
    notes: plan.notes,
  }
}
