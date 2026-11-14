import { askJSON, JSON_ONLY } from '../_shared/ai.ts'
import { handleOptions, json } from '../_shared/http.ts'
import {
  addDays,
  allowedDays,
  checkTaskList,
  describeDays,
  describeInput,
  normalize,
  TASK_SHAPE,
  type PlanInput,
  type TaskDraft,
} from '../_shared/plan.ts'

Deno.serve(async (req) => {
  const pre = handleOptions(req)
  if (pre) return pre
  try {
    const { input, start_date } = (await req.json()) as { input: PlanInput; start_date: string }
    const cap = addDays(start_date, 89) // 長すぎる期限は90日分まで作る
    const end = input.deadline < cap ? input.deadline : cap
    const days = allowedDays(input, start_date, end)
    if (days.length === 0) return json({ error: '期限までに勉強できる日がありません' }, 400)

    const system = `あなたは大学生と一緒に勉強計画を作るアシスタントです。本人の生活に合った、続けられる計画を作ります。${JSON_ONLY}`
    const user = `# 本人から聞いたこと
${describeInput(input)}

# 予定を入れてよい日
${describeDays(days)}

# ルール
- 「予定を入れてよい日」にだけ予定を入れる。基本は1日1件
- 1日の合計は${input.daily_minutes}分以下にする
- title は、その日に何をやるか本人がすぐわかる具体的な内容にする（例：「第3章 需要と供給」「過去問 1回目」）
- 補足にある教材や範囲を使う。わからなければ一般的な進め方で作る
- 前半で範囲を一通り進め、期限が近づいたら復習や過去問に移る
- original_date はすべて null にする

# 出力の形
${TASK_SHAPE}`

    const result = await askJSON<{ tasks: TaskDraft[] }>(system, user, (v) =>
      checkTaskList(v, days, input.daily_minutes),
    )
    return json({ tasks: normalize(result.tasks) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '計画を作れませんでした' }, 502)
  }
})
