/**
 * 公開してよい設定値。ここに書けば、Vercel などで環境変数を設定しなくても動く。
 * どれもビルド後のアプリに含まれてブラウザから見える値なので、コードに書いて問題ない。
 * （データは Supabase の行レベルセキュリティで守っている）
 *
 * 絶対に書かないもの：service_role キー（sb_secret_...）、Anthropic の APIキー、VAPID の秘密鍵。
 * 環境変数（.env や Vercel）を設定した場合は、そちらが優先される。
 */
export const PUBLIC_CONFIG = {
  /** Supabase の Project Settings > API の Project URL */
  supabaseUrl: '',
  /** Supabase の anon public キー（eyJ... または sb_publishable_...） */
  supabaseAnonKey: '',
  /** 通知用 VAPID キーの「公開鍵」 */
  vapidPublicKey: '',
}

const env = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

export const config = {
  supabaseUrl: env(import.meta.env.VITE_SUPABASE_URL) ?? env(PUBLIC_CONFIG.supabaseUrl),
  supabaseAnonKey: env(import.meta.env.VITE_SUPABASE_ANON_KEY) ?? env(PUBLIC_CONFIG.supabaseAnonKey),
  vapidPublicKey: env(import.meta.env.VITE_VAPID_PUBLIC_KEY) ?? env(PUBLIC_CONFIG.vapidPublicKey),
}
