import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Loading, Page } from '@/components/Page'
import { isConfigured } from '@/lib/supabase'
import { ensureUser, savePlan } from '@/lib/repository'
import { buildSample } from '@/lib/sample'
import { today } from '@/lib/date'
import Today from '@/pages/Today'
import Onboarding from '@/pages/Onboarding'
import PlanPage from '@/pages/PlanPage'
import Replan from '@/pages/Replan'
import Log from '@/pages/Log'

export default function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConfigured) return
    ;(async () => {
      try {
        const { isNew } = await ensureUser()
        if (isNew) {
          // 初回だけサンプル計画を入れる
          const sample = buildSample(today())
          await savePlan(sample.input, sample.tasks, true)
        }
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : '起動できませんでした')
      }
    })()
  }, [])

  if (!isConfigured) {
    return (
      <Page>
        <h1 className="mt-10 text-title font-bold">Supabaseの設定がまだです</h1>
        <p className="mt-4 text-body text-sub">
          .env.example を .env にコピーして、VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を入れてから開き直してください。手順はREADMEにあります。
        </p>
      </Page>
    )
  }
  if (error) {
    return (
      <Page>
        <h1 className="mt-10 text-title font-bold">起動できませんでした</h1>
        <p className="mt-4 text-body text-sub">{error}</p>
        <p className="mt-2 text-body text-sub">Supabaseで匿名ログインが有効になっているか確認してください。</p>
      </Page>
    )
  }
  if (!ready) return <Page><Loading message="準備しています" /></Page>

  return (
    <Routes>
      <Route path="/" element={<Today />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/plan" element={<PlanPage />} />
      <Route path="/replan" element={<Replan />} />
      <Route path="/log" element={<Log />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
