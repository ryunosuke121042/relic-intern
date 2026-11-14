import { adminClient, isCron, json } from '../_shared/http.ts'
import { sendToUser } from '../_shared/push.ts'
import { latestPlansPerUser, runReplan } from '../_shared/replan-core.ts'

/** 毎晩21時：崩れていれば組み直し案を作り、遅れを通知する */
Deno.serve(async (req) => {
  if (!isCron(req)) return json({ error: 'forbidden' }, 401)
  const db = adminClient()
  const plans = await latestPlansPerUser(db)
  let created = 0
  let notified = 0
  for (const plan of plans) {
    try {
      const result = await runReplan(db, plan.id)
      if (!result.created) continue
      created++
      notified += await sendToUser(db, plan.user_id, {
        title: '目標達成アプリ',
        body: `${plan.goal}、${result.missedDays}日分の遅れがあります`,
        url: '/replan',
      })
    } catch (e) {
      console.error('nightly-check', plan.id, e)
    }
  }
  return json({ plans: plans.length, created, notified })
})
