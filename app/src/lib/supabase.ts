import { createClient } from '@supabase/supabase-js'
import { config } from '@/config'

const url = config.supabaseUrl
const anonKey = config.supabaseAnonKey

export const isConfigured = Boolean(url && anonKey)

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})
