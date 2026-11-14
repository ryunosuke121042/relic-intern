/** Claude API を呼び、JSONで答えを受け取る */

const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-sonnet-5-5'

async function callOnce(system: string, user: string, maxTokens: number): Promise<unknown> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY が設定されていません')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`AIの呼び出しに失敗しました（${res.status}）`)
  const data = await res.json()
  const text = (data.content ?? [])
    .map((b: { type: string; text?: string }) => (b.type === 'text' ? b.text ?? '' : ''))
    .join('')
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('AIの答えがJSONではありませんでした')
  return JSON.parse(cleaned.slice(start, end + 1))
}

/**
 * JSONで答えをもらい、check で中身を確かめる。
 * 形が崩れていたら、理由を伝えて1回だけ再試行する。それでもだめなら例外を投げる。
 */
export async function askJSON<T>(
  system: string,
  user: string,
  check: (value: unknown) => string | null,
  maxTokens = 8000,
): Promise<T> {
  let lastProblem = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? user
      : `${user}\n\n前回の答えには次の問題がありました：${lastProblem}\nルールを守って、JSONだけを答え直してください。`
    try {
      const value = await callOnce(system, prompt, maxTokens)
      const problem = check(value)
      if (!problem) return value as T
      lastProblem = problem
    } catch (e) {
      lastProblem = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(lastProblem || 'AIの答えを使えませんでした')
}

export const JSON_ONLY =
  '答えはJSONだけを出力してください。前置き、説明、マークダウンのコードブロックは書かないでください。'
