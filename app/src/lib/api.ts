/**
 * 計画づくり・組み直しの呼び出し。
 * Supabase の設定があれば Edge Functions（AI）を、なければこの端末でルールに沿って作る。
 */
import { isConfigured } from './supabase'
import { api as remote } from './backend/supabaseApi'
import { api as local } from './backend/localApi'

export const api: typeof remote = isConfigured ? remote : local
