import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Download, Minimize2, Video } from 'lucide-react'

import { Button } from '../ui'
import { AnnexBVideoCanvas } from './AnnexBVideoCanvas'
import type { LiveStreamStatus } from '../shared/types'
import type { LiveWindowResolution } from '../shared/types/liveStream'
import '../styles/live-control-panel.css'

const MOBILE_APP_DOWNLOAD_URL = 'https://lunaka.diamondfsd.com/'

interface LiveControlPanelProps {
  status: LiveStreamStatus
  busy: boolean
  windowResolution: LiveWindowResolution
  onStart: () => void
  windowLiveMode: boolean
  onExitWindowLiveMode: () => void
  onPreviewClick?: (event: MouseEvent<HTMLDivElement>) => void
}

function previewStatusLabel(status: LiveStreamStatus, previewReady: boolean): string {
  if (status.usbState === 'streaming') return previewReady ? '画面已连接' : '正在打开画面'
  if (status.state === 'starting') return '正在连接'
  return status.usbMessage || '等待手机连接'
}

export function LiveControlPanel({
  status,
  busy,
  windowResolution,
  onStart,
  windowLiveMode,
  onExitWindowLiveMode,
  onPreviewClick,
}: LiveControlPanelProps) {
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const [previewAspectRatio, setPreviewAspectRatio] = useState(16 / 9)
  const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
  const [previewReady, setPreviewReady] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const windowLiveModeRef = useRef(windowLiveMode)
  const windowResolutionRef = useRef(windowResolution)
  const lastWindowAspectRef = useRef<number | null>(null)
  windowLiveModeRef.current = windowLiveMode
  windowResolutionRef.current = windowResolution

  const active = Boolean(status.startedAt) && status.state !== 'stopping'
  const streaming = status.usbState === 'streaming'

  useEffect(() => {
    const pane = previewPaneRef.current
    if (!pane) return undefined
    const update = () => {
      const rect = pane.getBoundingClientRect()
      let width = rect.width
      let height = width / previewAspectRatio
      if (height > rect.height) {
        height = rect.height
        width = height * previewAspectRatio
      }
      setPreviewStageSize({ width: Math.max(0, width), height: Math.max(0, height) })
    }
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    update()
    return () => observer.disconnect()
  }, [previewAspectRatio])

  const handlePreviewFrame = useCallback((dimensions: { width: number; height: number }) => {
    const aspectRatio = dimensions.width / dimensions.height
    setPreviewAspectRatio(aspectRatio)
    setPreviewReady(true)
    setPreviewError(null)
    if (!windowLiveModeRef.current) {
      lastWindowAspectRef.current = null
      return
    }
    if (lastWindowAspectRef.current == null || Math.abs(lastWindowAspectRef.current - aspectRatio) > 0.002) {
      lastWindowAspectRef.current = aspectRatio
      void window.luna.setLiveWindowMode(true, windowResolutionRef.current, aspectRatio).catch((error: unknown) => {
        window.luna.log('warn', '窗口直播画面尺寸调整失败', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }, [])

  const handlePreviewError = useCallback((message: string) => {
    setPreviewReady(false)
    setPreviewError(message)
  }, [])

  return (
    <section className="live-control-panel" aria-label="直播预览">
      <div ref={previewPaneRef} className="live-preview-pane" onClick={onPreviewClick}>
        <div
          className="live-preview-stage"
          style={{ width: previewStageSize.width, height: previewStageSize.height }}
        >
          {status.localPreviewUrl && (
            <AnnexBVideoCanvas
              url={status.localPreviewUrl}
              resolution={windowResolution}
              className="live-preview-canvas"
              onFrame={handlePreviewFrame}
              onError={handlePreviewError}
            />
          )}

          {!active && (
            <div className="live-preview-overlay live-preview-onboarding">
              <ol>
                <li>
                  <span>1</span>
                  <p>打开 Luna 咔，连接相机</p>
                  {!status.receiverConnected && (
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
                <li><span>2</span><p>用 USB 连接手机和电脑</p></li>
              </ol>
              <div className="live-preview-actions">
                <Button
                  variant="primary"
                  icon={<Video size={15} />}
                  onClick={onStart}
                  disabled={busy}
                >
                  {busy ? '处理中...' : '获取画面'}
                </Button>
              </div>
            </div>
          )}

          {active && !streaming && (
            <div className="live-preview-overlay">
              <strong>{status.state === 'starting' ? '正在启动' : '等待手机连接'}</strong>
              {status.state !== 'starting' && <span>用 USB 连接手机和电脑</span>}
            </div>
          )}

          {streaming && (previewError || !previewReady) && (
            <div className="live-preview-overlay">
              <strong>{previewError ?? status.localPreviewError ?? (status.localPreviewUrl ? '正在打开直播画面' : '正在准备软件预览')}</strong>
            </div>
          )}
        </div>
      </div>

      {windowLiveMode && (
        <aside className="live-control-pane" data-live-window-controls aria-label="窗口直播控制">
          <span className="live-window-preview-status">{previewStatusLabel(status, previewReady)}</span>
          <Button
            variant="secondary"
            size="compact"
            icon={<Minimize2 size={14} />}
            onClick={onExitWindowLiveMode}
            disabled={busy}
          >
            退出窗口直播
          </Button>
        </aside>
      )}
    </section>
  )
}
