import type { PlanInput, TaskDraft } from '@/types'

const KEY = 'plan-draft'

export interface PlanDraft {
  input: PlanInput
  tasks: TaskDraft[]
}

export function saveDraft(draft: PlanDraft) {
  sessionStorage.setItem(KEY, JSON.stringify(draft))
}

export function loadDraft(): PlanDraft | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PlanDraft
  } catch {
    return null
  }
}

export function clearDraft() {
  sessionStorage.removeItem(KEY)
}
