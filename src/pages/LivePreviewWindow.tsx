import { useCallback, useEffect, useRef, useState } from 'react'

import { AnnexBVideoCanvas } from '../components/AnnexBVideoCanvas'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { watermarkPositionStyle } from '../components/htmlPreviewGeometry'
import type { LivePreviewWindowSettings } from '../shared/types'
import '../styles/live-preview-window.css'

export function LivePreviewWindow() {
  const [settings, setSettings] = useState<LivePreviewWindowSettings | null>(null)
  const lastAspectRatio = useRef(0)

  useEffect(() => {
    document.documentElement.classList.add('live-preview-window-shell')
    let receivedUpdate = false
    const unsubscribe = window.luna.onLivePreviewWindowSettings((nextSettings) => {
      receivedUpdate = true
      setSettings(nextSettings)
    })
    void window.luna.getLivePreviewWindowSettings().then((initialSettings) => {
      if (!receivedUpdate && initialSettings) setSettings(initialSettings)
    }).catch((error: unknown) => {
      window.luna.log('warn', '直播窗口画面设置读取失败', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return () => {
      unsubscribe()
      document.documentElement.classList.remove('live-preview-window-shell')
    }
  }, [])

  const handleFrame = useCallback((dimensions: { width: number; height: number }) => {
    const aspectRatio = dimensions.width / dimensions.height
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return
    if (lastAspectRatio.current > 0 && Math.abs(lastAspectRatio.current - aspectRatio) < 0.002) return
    lastAspectRatio.current = aspectRatio
    void window.luna.resizeLivePreviewWindow(aspectRatio).catch((error: unknown) => {
      window.luna.log('warn', '直播窗口尺寸调整失败', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, [])

  const handleError = useCallback((message: string) => {
    window.luna.log('warn', '直播窗口画面渲染失败', { error: message })
  }, [])

  const watermarkSrc = filePathToPreviewUrl(settings?.watermark?.src)

  return (
    <main className="live-preview-window" aria-label="直播画面">
      {settings?.url && (
        <AnnexBVideoCanvas
          url={settings.url}
          lutPath={settings.lutPath}
          lutIntensity={settings.lutIntensity}
          colorAdjustments={settings.colorAdjustments}
          className="live-preview-window-canvas"
          onFrame={handleFrame}
          onError={handleError}
          onEffectError={handleError}
        />
      )}
      {settings?.watermark && watermarkSrc && (
        <img
          className="live-preview-window-watermark"
          src={watermarkSrc}
          alt=""
          draggable={false}
          style={{
            ...watermarkPositionStyle(settings.watermark.positioning),
            opacity: settings.watermark.opacity,
          }}
        />
      )}
    </main>
  )
}
