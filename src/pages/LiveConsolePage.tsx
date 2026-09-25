import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Square } from 'lucide-react'

import { Button, IconButton, LoadingIndicator, Tooltip, toast } from '../ui'
import { LiveControlPanel } from '../components/LiveControlPanel'
import type { LiveStreamStatus } from '../shared/types'
import '../styles/live-console.css'

function stateLabel(status: LiveStreamStatus | null): string {
  switch (status?.state) {
    case 'running': return '直播中'
    case 'waiting-usb': return '等待 USB'
    case 'starting': return '连接中'
    case 'stopping': return '停止中'
    case 'ready': return '已就绪'
    case 'error': return '异常'
    default: return '未启动'
  }
}

export function LiveConsolePage() {
  const [status, setStatus] = useState<LiveStreamStatus | null>(null)
  const [enhanceQuality, setEnhanceQuality] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const next = await window.luna.liveStream.status()
      setStatus(next)
      setError(next.error)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!status?.startedAt || status.state === 'stopping') return undefined
    const timer = window.setInterval(() => void refreshStatus(), 1_000)
    return () => window.clearInterval(timer)
  }, [refreshStatus, status?.startedAt, status?.state])

  const runAction = useCallback(async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
      void refreshStatus()
    }
  }, [busy, refreshStatus])

  const active = Boolean(status?.startedAt) && status?.state !== 'stopping'
  const outputTone = status?.outputReady ? 'active' : error || status?.state === 'error' ? 'danger' : 'neutral'

  return (
    <main className="live-console-page">
      <header className="live-console-header">
        <div className="live-console-title">
          <span className={`live-console-status-dot ${outputTone}`} />
          <h1>直播控制台</h1>
          <span className={`live-console-badge ${status?.outputReady ? 'active' : ''}`}>{stateLabel(status)}</span>
        </div>
        <div className="live-console-actions">
          <Tooltip content="刷新状态">
            <IconButton
              variant="outline"
              size="compact"
              icon={<RefreshCw size={15} />}
              aria-label="刷新状态"
              title="刷新状态"
              onClick={() => void refreshStatus()}
              disabled={busy}
            />
          </Tooltip>
          {active && (
            <Button
              variant="danger"
              size="compact"
              icon={<Square size={14} />}
              onClick={() => void runAction(async () => {
                await window.luna.liveStream.stop()
                toast.success('已停止获取画面')
              })}
              disabled={busy}
            >
              停止获取
            </Button>
          )}
        </div>
      </header>

      {error && <p className="live-console-error" role="alert">{error}</p>}
      {!status ? (
        <LoadingIndicator label="正在检查直播状态" />
      ) : (
        <LiveControlPanel
          status={status}
          busy={busy}
          enhanceQuality={enhanceQuality}
          onEnhanceQualityChange={setEnhanceQuality}
          onStart={() => void runAction(async () => {
            await window.luna.liveStream.start()
            toast.success('已开始获取画面')
          })}
          onStartOutput={() => void runAction(async () => {
            const next = await window.luna.liveStream.startOutput({ enhanceQuality })
            setStatus(next)
            toast.success('直播已开始')
          })}
          onStopOutput={() => void runAction(async () => {
            const next = await window.luna.liveStream.stopOutput()
            setStatus(next)
            toast.success('直播已停止')
          })}
        />
      )}
    </main>
  )
}
