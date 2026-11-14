import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

/** 画面の枠。bottom に置いたものは親指の届く画面下部に固定する */
export function Page({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <>
      <main className="mx-auto min-h-dvh w-full max-w-app px-5 pb-48 pt-[calc(1rem+env(safe-area-inset-top))]">
        {children}
      </main>
      {bottom && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-base/95 backdrop-blur">
          <div className="mx-auto w-full max-w-app px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
            {bottom}
          </div>
        </div>
      )}
    </>
  )
}

export function BackLink({ to = '/', label = '今日に戻る' }: { to?: string; label?: string }) {
  return (
    <Link
      to={to}
      className="-ml-2 inline-flex min-h-tap items-center gap-1 rounded-2xl px-2 text-body text-sub hover:text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60"
    >
      <ChevronLeft className="h-6 w-6" aria-hidden />
      {label}
    </Link>
  )
}

export function Loading({ message = '読み込んでいます' }: { message?: string }) {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center" role="status">
      <p className="text-body text-sub">{message}</p>
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-late/60 p-5" role="alert">
      <p className="text-body">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 min-h-tap rounded-2xl px-2 text-body font-bold text-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60"
        >
          もう一度読み込む
        </button>
      )}
    </div>
  )
}
