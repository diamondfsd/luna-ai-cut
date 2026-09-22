import { useCallback, useEffect, useState } from 'react'
import { CameraOff, Copy, Maximize2, Minimize2, Radio, Square } from 'lucide-react'

import { Button, Dialog, IconButton, LoadingIndicator, toast, Tooltip } from '../ui'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import type { CameraVideoStreamStatus } from '../shared/types'
import '../styles/camera-live-preview.css'

interface CameraLivePreviewDialogProps {
  open: boolean
  connected: boolean
  deviceId?: string
  host?: string
  mode: 'wireless' | 'wired'
  onOpenChange: (open: boolean) => void
}

export function CameraLivePreviewDialog({ open, connected, deviceId, host, mode, onOpenChange }: CameraLivePreviewDialogProps) {
  const [status, setStatus] = useState<CameraVideoStreamStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [obsError, setObsError] = useState<string | null>(null)
  const [obsBusy, setObsBusy] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [streamDimensions, setStreamDimensions] = useState<{ width: number; height: number } | null>(null)
  const [immersive, setImmersive] = useState(false)
  const handleFrame = useCallback((dimensions: { width: number; height: number }) => {
    setHasFrame(true)
    setStreamDimensions((current) => (
      current?.width === dimensions.width && current.height === dimensions.height ? current : dimensions
    ))
  }, [])
  const handleError = useCallback((message: string) => setError(message), [])

  useEffect(() => {
    if (!open || !connected) {
      setHasFrame(false)
      setStreamDimensions(null)
      if (!open) setStatus(null)
      return
    }

    let cancelled = false
    setHasFrame(false)
    setStreamDimensions(null)
    setError(null)
    setObsError(null)
    setObsBusy(false)
    setStatus(null)
    void window.luna.cameraVideoStream.start({ mode, deviceId, host })
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
      void window.luna.cameraVideoStream.stop({ mode, deviceId, host })
    }
  }, [connected, deviceId, host, mode, open])

  const enterImmersive = useCallback(() => {
    setImmersive(true)
    void window.luna.setFullScreen(true).catch(() => setImmersive(false))
  }, [])

  const exitImmersive = useCallback(() => {
    setImmersive(false)
    void window.luna.setFullScreen(false).catch(() => {})
  }, [])

  const toggleImmersive = useCallback(() => {
    if (immersive) exitImmersive()
    else enterImmersive()
  }, [enterImmersive, exitImmersive, immersive])

  useEffect(() => {
    if (!open) return
    const unsubscribe = window.luna.onFullScreenChange(setImmersive)
    return () => {
      unsubscribe()
      void window.luna.setFullScreen(false)
    }
  }, [open])

  useEffect(() => {
    if ((open && connected) || !immersive) return
    exitImmersive()
  }, [connected, exitImmersive, immersive, open])

  useEffect(() => {
    if (!open || !immersive) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      exitImmersive()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [exitImmersive, immersive, open])

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen && immersive) exitImmersive()
    onOpenChange(nextOpen)
  }

  async function toggleObsStream(): Promise<void> {
    if (!status || obsBusy) return
    setObsBusy(true)
    setObsError(null)
    try {
      const nextStatus = status.obsStreamUrl
        ? await window.luna.cameraVideoStream.stopObs({ mode, deviceId, host })
        : await window.luna.cameraVideoStream.startObs({ mode, deviceId, host })
      setStatus(nextStatus)
      if (nextStatus.obsStreamUrl) toast.success('OBS 地址已启动')
    } catch (cause: unknown) {
      setObsError(cause instanceof Error ? cause.message : 'OBS 地址启动失败')
    } finally {
      setObsBusy(false)
    }
  }

  async function copyObsUrl(): Promise<void> {
    const url = status?.obsStreamUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('OBS 地址已复制')
    } catch {
      setObsError('无法复制地址，请手动选择并复制')
    }
  }

  const waiting = !error && (!status || status.state === 'starting' || (status.state === 'running' && !hasFrame))
  const unsupported = status?.state === 'unsupported'
  const isObsStreaming = Boolean(status?.obsStreamUrl)
  const canControlObs = status?.state === 'running'

  const footer = (
    <div className={`camera-live-preview-footer${isObsStreaming ? ' is-streaming' : ''}`}>
      {isObsStreaming ? (
        <div className="camera-live-preview-obs-url" aria-live="polite">
          <span>OBS 推流地址</span>
          <div className="camera-live-preview-obs-url-value">
            <code>{status?.obsStreamUrl}</code>
            <IconButton
              variant="ghost"
              size="mini"
              icon={<Copy size={14} />}
              aria-label="复制 OBS 推流地址"
              title="复制 OBS 推流地址"
              onClick={() => void copyObsUrl()}
              disabled={obsBusy}
            />
          </div>
        </div>
      ) : null}
      <Button
        variant="secondary"
        size="compact"
        onClick={() => handleOpenChange(false)}
      >
        关闭
      </Button>
      {canControlObs ? (
        <Button
          variant={isObsStreaming ? 'danger' : 'secondary'}
          size="compact"
          icon={isObsStreaming ? <Square size={13} /> : <Radio size={15} />}
          onClick={() => void toggleObsStream()}
          disabled={obsBusy}
        >
          {obsBusy ? '准备中...' : isObsStreaming ? '停止推流' : '启动推流'}
        </Button>
      ) : null}
      {obsError && <span className="camera-live-preview-obs-error" role="alert">{obsError}</span>}
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="相机预览"
      className={`camera-live-preview-dialog${immersive ? ' is-immersive' : ''}`}
      tone="dark"
      footer={footer}
    >
      <div className="camera-live-preview-body">
        <div
          className="camera-live-preview-stage"
          style={streamDimensions && !immersive ? { aspectRatio: `${streamDimensions.width} / ${streamDimensions.height}` } : undefined}
        >
          <Tooltip content={immersive ? '退出全屏' : '全屏预览'}>
            <IconButton
              variant="light"
              className="camera-live-preview-fullscreen-toggle"
              icon={immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              onClick={toggleImmersive}
              title={immersive ? '退出全屏' : '全屏预览'}
              aria-label={immersive ? '退出全屏' : '全屏预览'}
              aria-pressed={immersive}
            />
          </Tooltip>
          {status?.streamUrl && status.state === 'running' && !unsupported ? (
            <AnnexBVideoCanvas
              url={status.streamUrl}
              className="camera-live-preview-canvas"
              onFrame={handleFrame}
              onError={handleError}
            />
          ) : null}
          {waiting && (
            <div className="camera-live-preview-placeholder">
              <LoadingIndicator label="正在连接相机画面" size="large" variant="media" />
            </div>
          )}
          {unsupported && (
            <div className="camera-live-preview-placeholder">
              <CameraOff size={28} />
              <span>{status.message}</span>
            </div>
          )}
          {error && (
            <div className="camera-live-preview-placeholder camera-live-preview-error" role="alert">
              <CameraOff size={28} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="camera-live-preview-status" aria-live="polite">
          <span className={`camera-live-preview-dot ${hasFrame ? 'active' : ''}`} />
          <span>{hasFrame ? '正在接收画面' : status?.message ?? '准备相机预览'}</span>
          {streamDimensions ? (
            <span className="camera-live-preview-resolution">
              分辨率 {streamDimensions.width} × {streamDimensions.height}
            </span>
          ) : null}
          {status && status.frames > 0 ? <span className="camera-live-preview-count">已接收画面</span> : null}
        </div>
      </div>
    </Dialog>
  )
}
