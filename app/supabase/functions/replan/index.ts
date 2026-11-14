import { handleOptions, json, userClient } from '../_shared/http.ts'
import { runReplan } from '../_shared/replan-core.ts'

/** アプリを開いたときに崩れていれば、その場で組み直す（ユーザーの権限で動く） */
Deno.serve(async (req) => {
  const pre = handleOptions(req)
  if (pre) return pre
  try {
    const { plan_id } = (await req.json()) as { plan_id: string }
    const db = userClient(req)
    const { data: auth } = await db.auth.getUser()
    if (!auth.user) return json({ error: 'ログインが必要です' }, 401)
    const result = await runReplan(db, plan_id)
    return json({ replan: result.replan })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '組み直せませんでした' }, 500)
  }
})
