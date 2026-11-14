import { askJSON, JSON_ONLY } from '../_shared/ai.ts'
import { handleOptions, json } from '../_shared/http.ts'
import { describeInput, type PlanInput } from '../_shared/plan.ts'

const DEFAULT = { questions: [{ question: '使う教材や、勉強する範囲を教えてください' }] }

Deno.serve(async (req) => {
  const pre = handleOptions(req)
  if (pre) return pre
  try {
    const { input } = (await req.json()) as { input: PlanInput }
    const system = `あなたは大学生と一緒に勉強計画を作るアシスタントです。${JSON_ONLY}`
    const user = `# 本人から聞いたこと
${describeInput(input)}

具体的な毎日の予定（「第3章 需要と供給」のような内容）を作るために、まだ足りない情報を1〜2問だけ質問してください。
- 教材、範囲、いまの理解度など、計画の中身に関わることだけを聞く
- すでに聞いたことは聞かない
- 1問は短く。答えの例を options に2〜4個つける

# 出力の形
{"questions":[{"question":"質問文","options":["例1","例2"]}]}`

    const result = await askJSON<{ questions: { question: string; options?: string[] }[] }>(
      system,
      user,
      (v) => {
        const qs = (v as { questions?: unknown })?.questions
        if (!Array.isArray(qs) || qs.length < 1 || qs.length > 2) return '質問は1〜2問にしてください'
        if (qs.some((q) => typeof q?.question !== 'string' || q.question.trim() === '')) return '質問文が空です'
        return null
      },
      1000,
    )
    return json(result)
  } catch {
    return json(DEFAULT)
  }
})
