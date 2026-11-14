import { askJSON, JSON_ONLY } from '../_shared/ai.ts'
import { handleOptions, json } from '../_shared/http.ts'
import {
  allowedDays,
  checkTaskList,
  describeDays,
  describeInput,
  normalize,
  TASK_SHAPE,
  type PlanInput,
  type TaskDraft,
} from '../_shared/plan.ts'

type Action = 'skip_day' | 'reduce' | 'change' | 'free'

interface Body {
  input: PlanInput
  tasks: TaskDraft[]
  action: Action
  date?: string
  request?: string
  range: { start: string; end: string }
}

function instruction(b: Body): string {
  switch (b.action) {
    case 'skip_day':
      return `${b.date} には予定を入れないでください。その日の予定は、近くの別の日に移すか、ほかの日の予定とまとめてください。`
    case 'reduce':
      return `${b.date} の予定の量を減らしてください（時間を短くするか、内容を絞る）。減らした分を、ほかの日に無理に足さなくてかまいません。`
    case 'change':
      return `${b.date} の予定を別の内容にしてください。ほかの日と内容が重ならないようにしてください。`
    case 'free':
      return `本人からの頼みごとに合わせて計画を直してください：「${b.request ?? ''}」`
  }
}

Deno.serve(async (req) => {
  const pre = handleOptions(req)
  if (pre) return pre
  try {
    const body = (await req.json()) as Body
    if (body.action !== 'free' && !body.date) return json({ error: '日付が指定されていません' }, 400)
    if (body.action === 'free' && !body.request?.trim()) return json({ error: '頼みごとが空です' }, 400)

    let days = allowedDays(body.input, body.range.start, body.range.end)
    // いまの予定が入っている日は、曜日の設定に関係なく使ってよい
    for (const t of body.tasks) if (!days.includes(t.date) && t.date >= body.range.start && t.date <= body.range.end) days.push(t.date)
    if (body.action === 'skip_day') days = days.filter((d) => d !== body.date)
    days.sort()

    const originalSum = body.tasks.filter((t) => t.date === body.date).reduce((s, t) => s + t.minutes, 0)

    const system = `あなたは大学生の勉強計画を一緒に直すアシスタントです。頼まれたところだけを直し、それ以外はできるだけそのままにします。${JSON_ONLY}`
    const user = `# 計画の前提
${describeInput(body.input)}

# いまの計画
${JSON.stringify({ tasks: body.tasks })}

# 頼まれたこと
${instruction(body)}

# 予定を入れてよい日
${describeDays(days)}

# ルール
- 頼まれたところ以外は、できるだけ変えない
- 「予定を入れてよい日」にだけ予定を入れる
- 1日の合計は${body.input.daily_minutes}分以下にする
- original_date は、いまの値をそのまま残す。今回新しく日を動かした予定には、動かす前の日付を入れる
- 計画全体（変えていない日も含めて）を返す

# 出力の形
${TASK_SHAPE}`

    const result = await askJSON<{ tasks: TaskDraft[] }>(system, user, (v) =>
      checkTaskList(v, days, body.input.daily_minutes, (tasks) => {
        if (body.action === 'reduce') {
          const after = tasks.filter((t) => t.date === body.date).reduce((s, t) => s + t.minutes, 0)
          const titlesBefore = body.tasks.filter((t) => t.date === body.date).map((t) => t.title).join()
          const titlesAfter = tasks.filter((t) => t.date === body.date).map((t) => t.title).join()
          if (after >= originalSum && titlesBefore === titlesAfter) return `${body.date} の量が減っていません`
        }
        return null
      }),
    )
    return json({ tasks: normalize(result.tasks) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '作り直せませんでした' }, 502)
  }
})
