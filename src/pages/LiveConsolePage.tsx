import { useCallback, useEffect, useRef, useState } from 'react'
import { HelpCircle, RefreshCw, Square, Video } from 'lucide-react'

import { Button, Dialog, IconButton, LoadingIndicator, Tooltip, toast } from '../ui'
import { LiveControlPanel } from '../components/LiveControlPanel'
import { flushLiveUsage } from '../hooks/useLiveUsage'
import type { LiveStreamStatus } from '../shared/types'
import '../styles/live-console.css'

interface LiveConsolePageProps {
  windowLiveMode: boolean
  onWindowLiveModeChange: (enabled: boolean) => void
}

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

export function LiveConsolePage({ windowLiveMode, onWindowLiveModeChange }: LiveConsolePageProps) {
  const [status, setStatus] = useState<LiveStreamStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoStartRequested = useRef(false)

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

  useEffect(() => {
    if (autoStartRequested.current) return
    autoStartRequested.current = true
    void runAction(async () => {
      await window.luna.liveStream.start()
    })
  }, [runAction])

  const active = Boolean(status?.startedAt) && status?.state !== 'stopping'
  const outputTone = status?.usbState === 'streaming' ? 'active' : error || status?.state === 'error' ? 'danger' : 'neutral'

  const toggleLivePreviewWindow = () => {
    void runAction(async () => {
      const nextEnabled = !windowLiveMode
      await window.luna.setLiveWindowMode(nextEnabled, nextEnabled ? '720p' : undefined)
      onWindowLiveModeChange(nextEnabled)
    })
  }

  return (
    <main className="live-console-page">
      <header className="live-console-header" data-live-window-controls>
        <div className="live-console-title">
          <span className={`live-console-status-dot ${outputTone}`} />
          <h1>直播控制台</h1>
          <span className={`live-console-badge ${status?.usbState === 'streaming' ? 'active' : ''}`}>{stateLabel(status)}</span>
        </div>
        <div className="live-console-actions">
          <Dialog
            trigger={(
              <Button variant="secondary" size="compact" icon={<HelpCircle size={14} />}>
                操作说明
              </Button>
            )}
            title="操作说明"
            tone="dark"
          >
            <ol className="live-console-instructions">
              <li>在手机 Luna 咔中连接相机。</li>
              <li>用 USB 线连接手机和电脑。</li>
              <li>直播画面会自动连接，等待预览区出现画面。</li>
              <li>可调整水印和色彩；点击“直播模式”打开独立预览。</li>
              <li>打开抖音直播伴侣，在场景中添加“窗口画面”，选择直播预览窗口。</li>
            </ol>
          </Dialog>
          {(Boolean(status?.videoFrames) || windowLiveMode) && (
            <Button
              variant={windowLiveMode ? 'secondary' : 'primary'}
              size="compact"
              icon={<Video size={14} />}
              onClick={toggleLivePreviewWindow}
              disabled={busy}
            >
              {windowLiveMode ? '退出直播模式' : '直播模式'}
            </Button>
          )}
          <Tooltip content="刷新状态">
            <IconButton
              variant="outline"
              size="compact"
              icon={<RefreshCw size={14} />}
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
                flushLiveUsage()
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

      {error && <p className="live-console-error" role="alert" data-live-window-controls>{error}</p>}
      {!status ? (
        windowLiveMode ? null : <LoadingIndicator label="正在检查直播状态" />
      ) : (
        <LiveControlPanel
          status={status}
          busy={busy}
          onStart={() => void runAction(async () => {
            await window.luna.liveStream.start()
            toast.success('已开始获取画面')
          })}
        />
      )}
    </main>
  )
}
