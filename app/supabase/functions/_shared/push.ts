import webpush from 'npm:web-push@3.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

let configured = false
function configure() {
  if (configured) return
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  configured = true
}

/** ユーザーの全端末に通知を送る。無効になった登録は消す */
export async function sendToUser(
  db: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url?: string },
): Promise<number> {
  configure()
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', userId)
  let sent = 0
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ url: '/replan', ...payload }),
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await db.from('push_subscriptions').delete().eq('id', sub.id)
      } else {
        console.error('通知の送信に失敗', status, e)
      }
    }
  }
  return sent
}
