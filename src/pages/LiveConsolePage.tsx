import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Square } from 'lucide-react'

import { Button, IconButton, LoadingIndicator, Switch, Tooltip, toast } from '../ui'
import { LiveControlPanel } from '../components/LiveControlPanel'
import type { DesktopVirtualCameraStatus } from '../shared/types'
import '../styles/live-console.css'

const DEFAULT_PORT = 4184
function stateLabel(status: DesktopVirtualCameraStatus | null): string {
  switch (status?.state) {
    case 'running': return '输出中'
    case 'waiting-usb': return '等待 USB'
    case 'starting': return '启动中'
    case 'stopping': return '停止中'
    case 'needs-approval': return '等待授权'
    case 'ready': return '已就绪'
    case 'not-installed': return '未安装'
    case 'unsupported': return '不支持'
    case 'error': return '异常'
    default: return '检查中'
  }
}

export function LiveConsolePage() {
  const [status, setStatus] = useState<DesktopVirtualCameraStatus | null>(null)
  const [audioDelayMs, setAudioDelayMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const next = await window.luna.desktopVirtualCamera.status()
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
    void window.luna.getSettings().then((settings) => setAudioDelayMs(settings.liveAudioDelayMs ?? 0))
  }, [])

  useEffect(() => {
    if (!status || !['starting', 'waiting-usb', 'running', 'stopping'].includes(status.state)) return undefined
    const timer = window.setInterval(() => void refreshStatus(), 1_000)
    return () => window.clearInterval(timer)
  }, [refreshStatus, status])

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

  const active = status?.state === 'running' || status?.state === 'waiting-usb' || status?.state === 'starting'
  const streaming = status?.usbState === 'streaming'
  const outputEnabled = Boolean(status?.outputEnabled)
  const needsApproval = status?.state === 'needs-approval' || status?.extensionState === 'waiting-approval'
  const canInstall = Boolean(
    status?.bundledHostAvailable
    && status.virtualMicrophoneAvailable
    && (!status.hostAppInstalled || !status.virtualMicrophoneInstalled),
  )
  const outputTone = streaming ? 'active' : error || status?.state === 'error' ? 'danger' : 'neutral'

  const commitAudioDelay = useCallback((value: number) => {
    setAudioDelayMs(value)
    void window.luna.saveSettings({ liveAudioDelayMs: value })
    if (active) void window.luna.desktopVirtualCamera.setAudioDelay(value)
  }, [active])

  const toggleVirtualCamera = useCallback((enabled: boolean) => {
    void runAction(async () => {
      const next = enabled
        ? await window.luna.desktopVirtualCamera.startOutput()
        : await window.luna.desktopVirtualCamera.stopOutput()
      setStatus(next)
      if (enabled && next.outputReady) toast.success('虚拟摄像头已开启')
    })
  }, [runAction])

  return (
    <main className="live-console-page">
      <header className="live-console-header">
        <div className="live-console-title">
          <span className={`live-console-status-dot ${outputTone}`} />
          <h1>直播控制台</h1>
          <span className={`live-console-badge ${streaming ? 'active' : ''}`}>{stateLabel(status)}</span>
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
          <label className="live-console-output-switch">
            <span>虚拟摄像头</span>
            <Switch
              checked={outputEnabled}
              onCheckedChange={toggleVirtualCamera}
              ariaLabel="虚拟摄像头输出"
              disabled={busy || !active}
            />
          </label>
          {active && (
            <Button
              variant="danger"
              size="compact"
              icon={<Square size={14} />}
              onClick={() => void runAction(async () => {
                await window.luna.desktopVirtualCamera.stop()
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
        <LoadingIndicator label="正在检查输出状态" />
      ) : (
        <LiveControlPanel
          status={status}
          audioDelayMs={audioDelayMs}
          busy={busy}
          canInstall={canInstall}
          needsApproval={needsApproval}
          onAudioDelayChange={setAudioDelayMs}
          onAudioDelayCommit={commitAudioDelay}
          onStart={() => void runAction(async () => {
            await window.luna.desktopVirtualCamera.start({ port: DEFAULT_PORT, audioDelayMs })
            toast.success('已开始获取画面')
          })}
          onInstall={() => void runAction(async () => {
            await window.luna.desktopVirtualCamera.install()
            toast.success(status.hostAppInstalled ? '虚拟麦克风已安装' : '音视频组件已安装')
          })}
          onOpenSettings={() => void window.luna.desktopVirtualCamera.openExtensionSettings()}
        />
      )}
    </main>
  )
}
