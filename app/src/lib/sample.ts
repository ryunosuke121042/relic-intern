import { addDays } from './logic'
import type { PlanInput, TaskDraft } from '@/types'

const TITLES = [
  '第1章 経済学の考え方',
  '第2章 需要と供給',
  '第2章 練習問題',
  '第3章 弾力性',
  '第3章 練習問題',
  '第4章 消費者の行動',
  '第4章 練習問題',
  '第5章 企業の行動',
  '第5章 練習問題',
  '第6章 完全競争市場',
  '第6章 練習問題',
  '第7章 独占',
  '第7章 練習問題',
  '第8章 市場の失敗',
  '第8章 練習問題',
  '1〜4章の復習',
  '5〜8章の復習',
  '過去問 1回目',
  '過去問 1回目の見直し',
  '過去問 2回目',
  '過去問 2回目の見直し',
  '苦手なところの総まとめ',
  '最終確認',
  '最終確認',
  '最終確認',
  '最終確認',
]

/** 経済学の期末試験、毎日30分、期限3週間後。直近2日はできなかった状態にしておく */
export function buildSample(today: string): { input: PlanInput; tasks: TaskDraft[] } {
  const start = addDays(today, -5)
  const deadline = addDays(today, 21)
  const tasks: TaskDraft[] = []
  let i = 0
  for (let d = start; d <= deadline; d = addDays(d, 1)) {
    const offset = i - 5
    tasks.push({
      date: d,
      title: TITLES[Math.min(i, TITLES.length - 1)],
      minutes: 30,
      original_date: null,
      status: offset <= -3 ? 'done' : offset < 0 ? 'missed' : 'pending',
    })
    i++
  }
  return {
    input: {
      goal: '経済学の期末試験',
      deadline,
      daily_minutes: 30,
      available_weekdays: [0, 1, 2, 3, 4, 5, 6],
      time_slot: '夜',
      busy_note: '火曜と木曜の夜はバイト',
      notes: '教科書はミクロ経済学の入門書。過去問が2回分ある',
    },
    tasks,
  }
}
