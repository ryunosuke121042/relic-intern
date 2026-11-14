export type DailyMinutes = 15 | 30 | 60
export type TaskStatus = 'pending' | 'done' | 'missed'

export interface Plan {
  id: string
  user_id: string
  goal: string
  deadline: string // 'YYYY-MM-DD'
  daily_minutes: DailyMinutes
  available_weekdays: number[] // 0=日 … 6=土
  time_slot: string
  busy_note: string
  notes: string // 聞き取りの追加質問への答え
  is_sample: boolean
  created_at: string
}

export interface Task {
  id: string
  plan_id: string
  date: string // 'YYYY-MM-DD'
  title: string
  minutes: number
  status: TaskStatus
  original_date: string | null
  updated_at: string
}

/** 保存前の予定（計画案・組み直し案） */
export interface TaskDraft {
  date: string
  title: string
  minutes: number
  original_date: string | null
  status?: TaskStatus
}

export interface ReplanProposal {
  window_start: string
  window_end: string
  tasks: TaskDraft[]
}

export interface Replan {
  id: string
  plan_id: string
  triggered_at: string
  missed_task_ids: string[]
  proposal: ReplanProposal
  confirmed_at: string | null
}

export interface PushSubscriptionRecord {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

/** 聞き取りで集める内容 */
export interface PlanInput {
  goal: string
  deadline: string
  daily_minutes: DailyMinutes
  available_weekdays: number[]
  time_slot: string
  busy_note: string
  notes: string
}

export type AdjustAction = 'skip_day' | 'reduce' | 'change' | 'free'

export interface FollowupQuestion {
  question: string
  options?: string[]
}
