import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clipboard, ExternalLink, Radio, RefreshCw, Square } from 'lucide-react'

import { Button, IconButton, Input, LoadingIndicator, Tooltip, toast } from '../ui'
import type { ObsStreamDemoStatus } from '../shared/types'
import '../styles/obs-stream-demo.css'

const IDLE_STATUS: ObsStreamDemoStatus = {
  state: 'idle',
  sourceName: 'Luna AI Cut OBS Demo',
  obsStreamUrl: null,
  previewUrl: '',
  port: null,
  bytes: 0,
  startedAt: null,
  message: 'OBS 视频源尚未启动',
  error: null,
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ObsStreamDemoPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<ObsStreamDemoStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const next = await window.luna.obsStreamDemo.status()
      setStatus(next)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (videoRef.current && status?.previewUrl) {
      videoRef.current.load()
      void videoRef.current.play().catch(() => undefined)
    }
  }, [status?.previewUrl])

  useEffect(() => {
    if (status?.state !== 'running') return undefined
    const timer = window.setInterval(() => {
      void window.luna.obsStreamDemo.status().then(setStatus).catch(() => undefined)
    }, 500)
    return () => window.clearInterval(timer)
  }, [status?.state])

  async function startStream(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.luna.obsStreamDemo.start()
      setStatus(next)
      toast.success('OBS 视频源已启动')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  async function stopStream(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      setStatus(await window.luna.obsStreamDemo.stop())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl(): Promise<void> {
    const url = status?.obsStreamUrl
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    toast.success('地址已复制')
    window.setTimeout(() => setCopied(false), 1_500)
  }

  const current = status ?? IDLE_STATUS
  const running = current.state === 'running'

  return (
    <main className="obs-stream-page">
      <header className="obs-stream-header">
        <div>
          <span className="obs-stream-eyebrow">LOCAL VIDEO OUTPUT</span>
          <h1>OBS 推流演示</h1>
          <p>用内置 MP4 生成本地视频流，直接交给 OBS 读取。</p>
        </div>
        <div className={`obs-stream-state${running ? ' active' : ''}`}>
          <Radio size={16} />
          <span>{running ? '推流中' : '未启动'}</span>
        </div>
      </header>

      <section className="obs-stream-status-bar" aria-label="OBS 视频源状态">
        <div className="obs-stream-status-copy">
          <span className={`obs-stream-status-dot${running ? ' active' : ''}`} />
          <div>
            <strong>{current.message}</strong>
            <span>{current.sourceName} · H.264 / MPEG-TS</span>
          </div>
        </div>
        <div className="obs-stream-actions">
          <Tooltip content="刷新视频源状态">
            <IconButton
              variant="outline"
              size="compact"
              icon={<RefreshCw size={15} />}
              aria-label="刷新视频源状态"
              title="刷新视频源状态"
              onClick={() => void refreshStatus()}
              disabled={busy}
            />
          </Tooltip>
          {running ? (
            <Button variant="danger" size="compact" icon={<Square size={14} />} onClick={() => void stopStream()} disabled={busy}>
              停止推流
            </Button>
          ) : (
            <Button variant="primary" size="compact" icon={<Radio size={15} />} onClick={() => void startStream()} disabled={busy}>
              {busy ? '正在启动...' : '开始推流'}
            </Button>
          )}
        </div>
      </section>

      <section className="obs-stream-layout">
        <div className="obs-stream-preview-column">
          <div className="obs-stream-section-heading">
            <div>
              <span className="obs-stream-section-index">01</span>
              <div>
                <h2>MP4 测试源</h2>
                <p>内置彩条视频，循环播放并实时转成 OBS 可读格式。</p>
              </div>
            </div>
            <span className="obs-stream-chip">1280 × 720 · 30 FPS</span>
          </div>
          <div className="obs-stream-stage">
            {current.previewUrl ? (
              <video ref={videoRef} src={current.previewUrl} muted loop playsInline controls aria-label="MP4 测试源预览" />
            ) : (
              <span className="obs-stream-placeholder">正在读取测试视频</span>
            )}
          </div>
        </div>

        <div className="obs-stream-output-column">
          <div className="obs-stream-section-heading">
            <div>
              <span className="obs-stream-section-index">02</span>
              <div>
                <h2>OBS 地址</h2>
                <p>把这个地址添加到 OBS 的媒体源中。</p>
              </div>
            </div>
            <span className={`obs-stream-chip${running ? ' active' : ''}`}>{running ? '可连接' : '等待启动'}</span>
          </div>
          <div className="obs-stream-url-row">
            <Input
              variant="compact"
              fullWidth
              readOnly
              value={current.obsStreamUrl ?? ''}
              placeholder="点击“开始推流”后生成地址"
              aria-label="OBS 媒体源地址"
            />
            <Tooltip content={copied ? '已复制' : '复制地址'}>
              <IconButton
                variant="outline"
                size="compact"
                icon={copied ? <Check size={15} /> : <Clipboard size={15} />}
                aria-label={copied ? '地址已复制' : '复制 OBS 地址'}
                title={copied ? '地址已复制' : '复制 OBS 地址'}
                onClick={() => void copyUrl()}
                disabled={!current.obsStreamUrl}
              />
            </Tooltip>
          </div>
          <div className="obs-stream-steps">
            <div><span>1</span><p>OBS 添加“媒体源”</p></div>
            <div><span>2</span><p>取消“本地文件”</p></div>
            <div><span>3</span><p>粘贴上方地址并确定</p></div>
          </div>
          <dl className="obs-stream-metrics">
            <div><dt>传输</dt><dd>{running ? 'MPEG-TS / HTTP' : '--'}</dd></div>
            <div><dt>已发送</dt><dd>{formatBytes(current.bytes)}</dd></div>
            <div><dt>端口</dt><dd>{current.port ?? '--'}</dd></div>
          </dl>
          {current.obsStreamUrl && (
            <Button
              variant="ghost"
              size="compact"
              icon={<ExternalLink size={14} />}
              onClick={() => void navigator.clipboard.writeText(current.obsStreamUrl ?? '')}
            >
              复制给 OBS
            </Button>
          )}
        </div>
      </section>

      <p className="obs-stream-notice">视频只在本机 127.0.0.1 提供，停止推流后 OBS 地址立即失效。</p>
      {error && <p className="obs-stream-error" role="alert">{error}</p>}
      {!status && <LoadingIndicator label="正在读取视频源状态" />}
    </main>
  )
}
