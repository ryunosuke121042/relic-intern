import * as ToastPrimitive from '@radix-ui/react-toast'
import { dismissToast, useToasts } from './use-toast'

export function Toaster() {
  const toasts = useToasts()
  return (
    <ToastPrimitive.Provider swipeDirection="down" duration={3000}>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id)
          }}
          className="rounded-2xl border-2 border-line bg-card px-5 py-4 text-body text-fg shadow-lg"
        >
          <ToastPrimitive.Description>{t.message}</ToastPrimitive.Description>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed inset-x-0 top-0 z-[60] mx-auto flex w-full max-w-app flex-col gap-2 p-4 pt-[calc(1rem+env(safe-area-inset-top))] outline-none" />
    </ToastPrimitive.Provider>
  )
}
