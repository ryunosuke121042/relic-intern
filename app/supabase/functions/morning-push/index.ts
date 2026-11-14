import { adminClient, isCron, json } from '../_shared/http.ts'
import { addDays, jstDate } from '../_shared/logic.ts'
import { sendToUser } from '../_shared/push.ts'
import { latestPlansPerUser } from '../_shared/replan-core.ts'

/**
 * 毎朝7時：崩れた翌朝以降、記録が再開するまで（最長7日）、組み直し後の今日の予定を通知する。
 */
Deno.serve(async (req) => {
  if (!isCron(req)) return json({ error: 'forbidden' }, 401)
  const db = adminClient()
  const today = jstDate()
  const plans = await latestPlansPerUser(db)
  let notified = 0

  for (const plan of plans) {
    try {
      const { data: replan } = await db
        .from('replans')
        .select('*')
        .eq('plan_id', plan.id)
        .order('triggered_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!replan) continue

      const triggeredDate = jstDate(new Date(replan.triggered_at))
      if (today <= triggeredDate || today > addDays(triggeredDate, 7)) continue

      // 崩れたあとに「できた」があれば、記録が再開したとみなして止める
      const { count } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', plan.id)
        .eq('status', 'done')
        .gt('updated_at', replan.triggered_at)
      if ((count ?? 0) > 0) continue

      let todays: { title: string; minutes: number }[]
      if (replan.confirmed_at) {
        const { data } = await db
          .from('tasks')
          .select('title, minutes')
          .eq('plan_id', plan.id)
          .eq('date', today)
          .eq('status', 'pending')
        todays = data ?? []
      } else {
        todays = (replan.proposal?.tasks ?? []).filter((t: { date: string }) => t.date === today)
      }
      if (todays.length === 0) continue // 今日は予定のない日

      const t = todays[0]
      notified += await sendToUser(db, plan.user_id, {
        title: '目標達成アプリ',
        body: `今日：${plan.goal} ${t.minutes}分（${t.title}）`,
        url: '/replan',
      })
    } catch (e) {
      console.error('morning-push', plan.id, e)
    }
  }
  return json({ plans: plans.length, notified })
})
