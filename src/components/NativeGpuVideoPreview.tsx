import { useEffect, useMemo, useRef, useState } from 'react'

import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { CompositionInput, PreviewLayer } from '../shared/types'
import { isNativePreviewOccluded, shouldShowNativePreview } from './nativePreviewOcclusion'
import { buildCompositionFromPreviewLayers } from './renderComposition'
import './NativeGpuVideoPreview.css'

interface NativePreviewBounds {
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
}

interface NativePreviewCapabilities {
  directGpuPresentation: boolean
}

interface NativePreviewApi {
  getNativePreviewCapabilities: () => Promise<NativePreviewCapabilities>
  createNativePreviewSession: (
    composition: CompositionInput,
    bounds: NativePreviewBounds,
  ) => Promise<number>
  updateNativePreviewComposition: (
    sessionId: number,
    composition: CompositionInput,
  ) => Promise<void>
  setNativePreviewBounds: (sessionId: number, bounds: NativePreviewBounds) => Promise<void>
  setNativePreviewVisible: (sessionId: number, visible: boolean) => Promise<void>
  playNativePreview: (sessionId: number, time: number) => Promise<void>
  pauseNativePreview: (sessionId: number, time: number) => Promise<void>
  seekNativePreview: (sessionId: number, time: number) => Promise<void>
  getNativePreviewSessionStats: (
    sessionId: number,
  ) => Promise<{ renderedFrames: number; renderErrors: number; lastRenderError?: string | null }>
  destroyNativePreviewSession: (sessionId: number) => Promise<void>
}

interface NativeGpuVideoPreviewProps {
  layers: PreviewLayer[]
  canvasWidth: number
  canvasHeight: number
  active?: boolean
  playing: boolean
  time?: number
  seekRevision?: number
  className?: string
  onVideoElement?: (element: HTMLMediaElement | null) => void
  onFallback: (reason: string) => void
  onRender?: () => void
}

function nativePreviewApi(): NativePreviewApi | null {
  return (window as Window & { lunaRenderCore?: NativePreviewApi }).lunaRenderCore ?? null
}

function boundsFor(element: HTMLElement): NativePreviewBounds | null {
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const scaleFactor = window.devicePixelRatio || 1
  const alignToDevicePixel = (value: number) => Math.round(value * scaleFactor) / scaleFactor
  return {
    x: alignToDevicePixel(rect.left),
    y: alignToDevicePixel(rect.top),
    width: alignToDevicePixel(rect.width),
    height: alignToDevicePixel(rect.height),
    scaleFactor,
  }
}

function compositionTimeFor(media: HTMLMediaElement, layer: PreviewLayer | undefined): number {
  const start = layer?.videoTime ?? 0
  const offset = layer?.videoOffset ?? 0
  return Math.max(0, media.currentTime - start + offset)
}

async function waitForRenderedFrame(
  api: NativePreviewApi,
  sessionId: number,
  previousFrames: number,
  isActive: () => boolean = () => true,
): Promise<boolean> {
  // Windows 首次创建 D3D12 管线并加载多个 LUT/水印时可能需要数秒。
  // 会话仍在正常渲染时不应过早销毁并回退。
  const deadline = performance.now() + 15000
  while (performance.now() < deadline) {
    if (!isActive()) return false
    const stats = await api.getNativePreviewSessionStats(sessionId)
    if (!isActive()) return false
    if (stats.renderErrors > 0) {
      throw new Error(stats.lastRenderError || '原生预览暂时无法显示画面（Rust 未提供错误详情）')
    }
    if (stats.renderedFrames > previousFrames) return true
    await new Promise((resolve) => window.setTimeout(resolve, 16))
  }
  if (!isActive()) return false
  throw new Error('等待原生预览画面超时')
}

export function NativeGpuVideoPreview({
  layers,
  canvasWidth,
  canvasHeight,
  active = true,
  playing,
  time = 0,
  seekRevision = 0,
  className,
  onVideoElement,
  onFallback,
  onRender,
}: NativeGpuVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playbackElementRef = useRef<HTMLMediaElement | null>(null)
  const sessionRef = useRef<number | null>(null)
  const surfaceVisibleRef = useRef<boolean | null>(null)
  const surfaceBoundsRef = useRef<NativePreviewBounds | null>(null)
  const occludedRef = useRef(false)
  const activeRef = useRef(active)
  const compositionRef = useRef<CompositionInput | null>(null)
  const compositionUpdateRef = useRef(0)
  const seekUpdateRef = useRef(0)
  const callbackRef = useRef({ onFallback, onRender, onVideoElement })
  const playbackRef = useRef({ playing, time, primaryLayer: layers.find((layer) => layer.isVideo) })
  const [initialBounds, setInitialBounds] = useState<NativePreviewBounds | null>(null)
  const primaryLayer = layers.find((layer) => layer.isVideo)
  callbackRef.current = { onFallback, onRender, onVideoElement }
  playbackRef.current = { playing, time, primaryLayer }
  activeRef.current = active
  const primarySource = primaryLayer
    ? filePathToPreviewUrl(primaryLayer.filePath) ?? primaryLayer.filePath
    : null
  const compositionSourceRef = useRef<string | null>(primarySource)
  const composition = useMemo(
    () => buildCompositionFromPreviewLayers(layers, canvasWidth, canvasHeight),
    [canvasHeight, canvasWidth, layers],
  )
  compositionRef.current = composition

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let scheduled = 0
    const syncSurface = () => {
      cancelAnimationFrame(scheduled)
      scheduled = requestAnimationFrame(() => {
        const bounds = boundsFor(canvas)
        const sessionId = sessionRef.current
        const api = nativePreviewApi()
        if (!bounds) {
          occludedRef.current = true
          if (sessionId !== null && api && surfaceVisibleRef.current !== false) {
            surfaceVisibleRef.current = false
            void api.setNativePreviewVisible(sessionId, false).catch(() => undefined)
          }
          return
        }
        const occluded = isNativePreviewOccluded(canvas)
        const visible = shouldShowNativePreview(activeRef.current, true, occluded)
        occludedRef.current = occluded
        if (sessionId === null) {
          setInitialBounds(bounds)
          return
        }
        if (!api) return
        const previousBounds = surfaceBoundsRef.current
        const boundsChanged = !previousBounds
          || previousBounds.x !== bounds.x
          || previousBounds.y !== bounds.y
          || previousBounds.width !== bounds.width
          || previousBounds.height !== bounds.height
          || previousBounds.scaleFactor !== bounds.scaleFactor
        const commands: Array<Promise<void>> = []
        if (boundsChanged) {
          surfaceBoundsRef.current = bounds
          commands.push(api.setNativePreviewBounds(sessionId, bounds))
        }
        if (surfaceVisibleRef.current !== visible) {
          surfaceVisibleRef.current = visible
          commands.push(api.setNativePreviewVisible(sessionId, visible))
        }
        if (commands.length === 0) return
        void Promise.all(commands)
          .catch((error: unknown) => {
            if (sessionRef.current === sessionId) {
              callbackRef.current.onFallback(
                error instanceof Error ? error.message : String(error),
              )
            }
          })
      })
    }
    const resizeObserver = new ResizeObserver(syncSurface)
    const mutationObserver = new MutationObserver(syncSurface)
    resizeObserver.observe(canvas)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'data-state'],
    })
    window.addEventListener('resize', syncSurface)
    window.addEventListener('scroll', syncSurface, true)
    // A grid reflow can move the canvas without resizing it, which ResizeObserver does not report.
    const positionTracker = window.setInterval(syncSurface, 100)
    syncSurface()
    return () => {
      cancelAnimationFrame(scheduled)
      window.clearInterval(positionTracker)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', syncSurface)
      window.removeEventListener('scroll', syncSurface, true)
    }
  }, [])

  useEffect(() => {
    if (!initialBounds) return
    const api = nativePreviewApi()
    if (!api) {
      callbackRef.current.onFallback('当前版本未加载原生预览能力')
      return
    }
    let cancelled = false
    let createdSession: number | null = null
    void api.getNativePreviewCapabilities()
      .then((capabilities) => {
        if (!capabilities.directGpuPresentation) {
          throw new Error('当前设备暂不支持原生画面显示')
        }
        return api.createNativePreviewSession(compositionRef.current ?? composition, initialBounds)
      })
      .then((sessionId) => {
        createdSession = sessionId
        if (cancelled) return api.destroyNativePreviewSession(sessionId)
        sessionRef.current = sessionId
        const visible = shouldShowNativePreview(activeRef.current, true, occludedRef.current)
        surfaceVisibleRef.current = visible
        surfaceBoundsRef.current = initialBounds
        const playbackElement = playbackElementRef.current
        const playback = playbackRef.current
        const time = playbackElement
          ? compositionTimeFor(playbackElement, playback.primaryLayer)
          : playback.time
        const command = playback.playing
          ? api.playNativePreview(sessionId, time)
          : api.pauseNativePreview(sessionId, time)
        return api.setNativePreviewVisible(sessionId, visible)
          .then(() => command)
          .then(() => (
            visible
              ? waitForRenderedFrame(api, sessionId, 0, () => (
                !cancelled && sessionRef.current === sessionId
              ))
              : true
          ))
          .then((rendered) => {
            if (rendered && !cancelled && sessionRef.current === sessionId) {
              callbackRef.current.onRender?.()
            }
          })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
        }
      })

    return () => {
      cancelled = true
      const sessionId = sessionRef.current ?? createdSession
      sessionRef.current = null
      surfaceVisibleRef.current = null
      surfaceBoundsRef.current = null
      if (sessionId !== null) {
        void api.setNativePreviewVisible(sessionId, false)
          .catch(() => undefined)
          .then(() => api.destroyNativePreviewSession(sessionId))
      }
    }
    // Keep the native Surface alive across media and composition changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(initialBounds)])

  useEffect(() => {
    const sessionId = sessionRef.current
    const api = nativePreviewApi()
    const canvas = canvasRef.current
    if (sessionId === null || !api || !canvas) return
    const bounds = boundsFor(canvas)
    const occluded = !bounds || isNativePreviewOccluded(canvas)
    const visible = shouldShowNativePreview(active, Boolean(bounds), occluded)
    occludedRef.current = occluded
    surfaceVisibleRef.current = visible
    if (!visible) {
      void api.setNativePreviewVisible(sessionId, false).catch(() => undefined)
      return
    }
    surfaceBoundsRef.current = bounds
    void api.setNativePreviewBounds(sessionId, bounds!)
      .then(() => api.setNativePreviewVisible(sessionId, true))
      .catch((error: unknown) => {
        if (sessionRef.current === sessionId) {
          callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
        }
      })
  }, [active])

  useEffect(() => {
    const sessionId = sessionRef.current
    if (sessionId === null) return
    const api = nativePreviewApi()
    if (!api) return
    const sourceChanged = compositionSourceRef.current !== primarySource
    compositionSourceRef.current = primarySource
    const updateId = ++compositionUpdateRef.current
    const isActive = () => (
      sessionRef.current === sessionId && compositionUpdateRef.current === updateId
    )
    void (async () => {
      try {
        const before = await api.getNativePreviewSessionStats(sessionId)
        if (!isActive()) return
        if (sourceChanged) {
          await api.pauseNativePreview(sessionId, 0)
          if (!isActive()) return
        }
        await api.updateNativePreviewComposition(sessionId, composition)
        if (!isActive()) return
        const rendered = occludedRef.current
          || await waitForRenderedFrame(api, sessionId, before.renderedFrames, isActive)
        if (rendered && isActive()) callbackRef.current.onRender?.()
      } catch (error: unknown) {
        if (isActive()) {
          callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
        }
      }
    })()
    return () => {
      if (compositionUpdateRef.current === updateId) compositionUpdateRef.current += 1
    }
  }, [composition, primarySource])

  useEffect(() => {
    const sessionId = sessionRef.current
    const playbackElement = playbackElementRef.current
    if (sessionId === null) return
    const playbackTime = playbackElement
      ? compositionTimeFor(playbackElement, playbackRef.current.primaryLayer)
      : playbackRef.current.time
    const api = nativePreviewApi()
    if (!api) return
    const command = playing
      ? api.playNativePreview(sessionId, playbackTime)
      : api.pauseNativePreview(sessionId, playbackTime)
    void command.catch((error: unknown) => {
      if (sessionRef.current === sessionId) {
        callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
      }
    })
    if (playing && playbackElement) {
      void playbackElement.play().catch(() => {})
    } else if (playbackElement) {
      playbackElement.pause()
    }
  }, [playing])

  useEffect(() => {
    if (seekRevision === 0) return
    const sessionId = sessionRef.current
    const api = nativePreviewApi()
    if (sessionId === null || !api) return
    const command = playing
      ? api.playNativePreview(sessionId, time)
      : api.seekNativePreview(sessionId, time)
    void command.catch((error: unknown) => {
      if (sessionRef.current === sessionId) {
        callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
      }
    })
    // Time changes every animation frame; seek only for an explicit replay or scrub action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRevision])

  useEffect(() => {
    if (!primarySource) return
    // Native preview owns video decoding and presentation. Keep only an audio
    // element for sound and the playback clock so Chromium does not decode a
    // second copy of every 4K frame.
    const playbackElement = document.createElement('audio')
    playbackElement.src = primarySource
    playbackElement.preload = 'metadata'
    playbackElement.muted = false
    const startTime = playbackRef.current.primaryLayer?.videoTime ?? 0
    const handleLoaded = () => {
      playbackElement.currentTime = startTime
      callbackRef.current.onVideoElement?.(playbackElement)
      if (playbackRef.current.playing) void playbackElement.play().catch(() => {})
    }
    const handleSeeked = () => {
      const sessionId = sessionRef.current
      const api = nativePreviewApi()
      if (sessionId === null || !api) return
      const updateId = ++seekUpdateRef.current
      const isActive = () => (
        sessionRef.current === sessionId
        && playbackElementRef.current === playbackElement
        && seekUpdateRef.current === updateId
      )
      void (async () => {
        try {
          const before = await api.getNativePreviewSessionStats(sessionId)
          if (!isActive()) return
          const time = compositionTimeFor(playbackElement, playbackRef.current.primaryLayer)
          const command = playbackRef.current.playing
            ? api.playNativePreview(sessionId, time)
            : api.seekNativePreview(sessionId, time)
                .then(() => api.pauseNativePreview(sessionId, time))
          await command
          if (!isActive()) return
          const rendered = occludedRef.current
            || await waitForRenderedFrame(api, sessionId, before.renderedFrames, isActive)
          if (rendered && isActive()) callbackRef.current.onRender?.()
        } catch (error: unknown) {
          if (isActive()) {
            callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
          }
        }
      })()
    }
    playbackElement.addEventListener('loadedmetadata', handleLoaded)
    playbackElement.addEventListener('seeked', handleSeeked)
    playbackElement.load()
    playbackElementRef.current = playbackElement
    return () => {
      seekUpdateRef.current += 1
      callbackRef.current.onVideoElement?.(null)
      playbackElement.removeEventListener('loadedmetadata', handleLoaded)
      playbackElement.removeEventListener('seeked', handleSeeked)
      playbackElement.pause()
      playbackElement.removeAttribute('src')
      playbackElement.load()
      playbackElementRef.current = null
    }
  }, [primarySource])

  return (
    <canvas
      ref={canvasRef}
      className={['native-gpu-video-preview', className].filter(Boolean).join(' ')}
      width={canvasWidth}
      height={canvasHeight}
      aria-label="视频预览"
    />
  )
}
