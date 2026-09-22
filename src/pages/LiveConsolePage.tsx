import { useCallback, useEffect, useState } from 'react'
import {
  Cable,
  CheckCircle2,
  Download,
  MonitorUp,
  RefreshCw,
  Settings2,
  Smartphone,
  Square,
  Video,
} from 'lucide-react'

import { Button, IconButton, LoadingIndicator, Slider, Tooltip, toast } from '../ui'
import type { DesktopVirtualCameraStatus } from '../shared/types'
import '../styles/live-console.css'

const DEFAULT_PORT = 4184
const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(value: string | null): string {
  if (!value) return '--'
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false })
}

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

function usbLabel(status: DesktopVirtualCameraStatus | null): string {
  switch (status?.usbState) {
    case 'streaming': return '正在接收画面和声音'
    case 'connected': return '已连接，等待画面和声音'
    case 'switching': return '正在切换 USB 模式'
    case 'waiting': return '等待手机连接'
    case 'error': return 'USB 接收异常'
    default: return '接收器未启动'
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
  const usbConnected = status?.usbState === 'connected' || streaming
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
          {canInstall && (
            <Button
              variant="secondary"
              size="compact"
              icon={<MonitorUp size={15} />}
              onClick={() => void runAction(async () => {
                await window.luna.desktopVirtualCamera.install()
                toast.success(status?.hostAppInstalled ? '虚拟麦克风已安装' : '音视频组件已安装')
              })}
              disabled={busy}
            >
              {status?.hostAppInstalled ? '安装虚拟麦克风' : '安装音视频组件'}
            </Button>
          )}
          {needsApproval && (
            <Button
              variant="secondary"
              size="compact"
              icon={<Settings2 size={15} />}
              onClick={() => void window.luna.desktopVirtualCamera.openExtensionSettings()}
              disabled={busy}
            >
              打开系统设置
            </Button>
          )}
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
        <section className="live-console-panel" aria-label="直播状态">
          <div className={`live-console-primary-state ${outputTone}`}>
            <span className="live-console-primary-icon">
              {streaming ? <CheckCircle2 size={24} /> : usbConnected ? <Cable size={24} /> : <Smartphone size={24} />}
            </span>
            <div>
              <strong>{usbLabel(status)}</strong>
            </div>
          </div>
          {!streaming && (
            <div className="live-console-setup">
              <ol>
                <li>
                  <span>1</span>
                  <p>打开 Luna 咔，连接相机设备</p>
                  {!usbConnected && (
                    <Button
                      variant="secondary"
                      size="mini"
                      icon={<Download size={14} />}
                      onClick={() => void window.luna.openPath(MOBILE_APP_DOWNLOAD_URL)}
                    >
                      下载 App
                    </Button>
                  )}
                </li>
                <li>
                  <span>2</span>
                  <p>使用 USB 将手机连接到电脑</p>
                </li>
              </ol>
              {!active && (
                <Button
                  variant="primary"
                  icon={<Video size={15} />}
                  onClick={() => void runAction(async () => {
                    await window.luna.desktopVirtualCamera.start({ port: DEFAULT_PORT, audioDelayMs })
                    toast.success('已开始获取画面')
                  })}
                  disabled={busy || status.state === 'unsupported' || needsApproval}
                >
                  {busy ? '处理中...' : '获取画面'}
                </Button>
              )}
            </div>
          )}
          <dl className="live-console-metrics">
            <div><dt>视频</dt><dd>{status.videoFrames} 帧</dd></div>
            <div><dt>音频</dt><dd>{status.audioFrames} 段</dd></div>
            <div>
              <dt>音频格式</dt>
              <dd>
                {status.audioSampleRate
                  ? `${(status.audioSampleRate / 1000).toFixed(1)} kHz / ${status.audioChannels ?? 1} ch`
                  : '--'}
              </dd>
            </div>
            <div><dt>最后收包</dt><dd>{formatTime(status.lastFrameAt)}</dd></div>
            <div><dt>视频数据</dt><dd>{formatBytes(status.videoBytes)}</dd></div>
            <div><dt>音频数据</dt><dd>{formatBytes(status.audioBytes)}</dd></div>
            <div><dt>虚拟麦克风</dt><dd>{status.virtualMicrophoneInstalled ? '已安装' : '未安装'}</dd></div>
          </dl>
          <div className="live-console-audio-delay">
            <div>
              <span>声音漂移</span>
              <output>{audioDelayMs > 0 ? '+' : ''}{audioDelayMs} ms</output>
            </div>
            <Slider
              value={audioDelayMs}
              min={-10_000}
              max={10_000}
              step={10}
              ariaLabel="声音漂移"
              onValueChange={setAudioDelayMs}
              onValueCommit={commitAudioDelay}
            />
          </div>
        </section>
      )}
    </main>
  )
}
