import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { enablePush, isIOS, isStandalone, permission, pushSupported } from '@/lib/push'

/** ホーム画面への追加と通知の許可を案内する */
export function NotificationSetup({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState(permission())
  const needsHomeScreen = isIOS() && !isStandalone()

  async function enable() {
    setBusy(true)
    try {
      const result = await enablePush()
      setState(result === 'unsupported' ? 'unsupported' : result)
      if (result === 'granted') {
        toast('通知をオンにしました')
        onOpenChange(false)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '通知をオンにできませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>崩れたときに知らせます</DialogTitle>
        <DialogDescription>
          2日続けてできなかったら、組み直した予定を通知で届けます。アプリを開かなくても、次にやることがわかります。
        </DialogDescription>

        {needsHomeScreen ? (
          <div className="mt-5 space-y-3 text-body">
            <p>iPhoneでは、ホーム画面に追加しないと通知が届きません。</p>
            <ol className="list-decimal space-y-2 pl-6">
              <li>Safariの下にある共有ボタンを押す</li>
              <li>「ホーム画面に追加」を選ぶ</li>
              <li>ホーム画面のアイコンから開き直して、もう一度この案内を開く</li>
            </ol>
          </div>
        ) : !pushSupported() ? (
          <p className="mt-5 text-body">このブラウザは通知に対応していません。ChromeかSafariで開いてください。</p>
        ) : state === 'granted' ? (
          <p className="mt-5 text-body text-done">通知はオンになっています。</p>
        ) : state === 'denied' ? (
          <p className="mt-5 text-body">
            通知がブロックされています。端末の設定で、このアプリの通知を許可してください。
          </p>
        ) : (
          <Button size="wide" className="mt-6" onClick={enable} disabled={busy}>
            {busy ? '設定しています' : '通知をオンにする'}
          </Button>
        )}

        <Button variant="quiet" size="wide" className="mt-3" onClick={() => onOpenChange(false)}>
          あとで
        </Button>
      </DialogContent>
    </Dialog>
  )
}
