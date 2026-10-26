import { useState } from 'react'
import { Button } from '../ui'
import './AppleServiceStartButton.css'

export function AppleServiceStartButton({ onChanged }: { onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await window.luna.liveStream.startAppleService()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      onChanged?.()
    }
  }
  return <div className="apple-service-start">
    <Button variant="secondary" size="compact" disabled={busy} onClick={() => void start()}>
      {busy ? '正在启动' : '启动苹果服务'}
    </Button>
    {error && <pre role="alert">{error}</pre>}
  </div>
}
