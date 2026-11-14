import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { addDays, jstDate, toUTC } from './logic'

/** 今日の日付（Asia/Tokyo） */
export function today(): string {
  return jstDate()
}

export { addDays, jstDate }

function asLocal(d: string): Date {
  const u = toUTC(d)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate())
}

/** 11月14日（土） */
export function longLabel(d: string): string {
  return format(asLocal(d), 'M月d日（E）', { locale: ja })
}

/** 11/14（土） */
export function shortLabel(d: string): string {
  return format(asLocal(d), 'M/d（E）', { locale: ja })
}

/** 11/14 */
export function mdLabel(d: string): string {
  return format(asLocal(d), 'M/d', { locale: ja })
}

/** 土 */
export function weekdayLabel(d: string): string {
  return format(asLocal(d), 'E', { locale: ja })
}

export function dayNumber(d: string): string {
  return String(asLocal(d).getDate())
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
