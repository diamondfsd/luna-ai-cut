import { forwardRef, useImperativeHandle, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { LrcRender } from './LrcRender'
import { MultipleLayerVideoPreviewLrcRender } from './MultipleLayerVideoPreviewLrcRender'
import { NativeGpuVideoPreview } from './NativeGpuVideoPreview'
import { WebGpuVideoPreview } from './WebGpuVideoPreview'
import { PreviewStageError } from './PreviewStageError'
import { useApp } from '../context/AppContext'
import type { PreviewLayer } from '../shared/types'
import { useIsLivePhoto } from '../shared/livePhoto'
import { LivePhotoBadge, VideoControls, toast } from '../ui'
import { isVideoPath } from '../lib/fileUtils'
import { applyBorderMediaLayout, buildLocalColorPrecomposition, outputSizeForTransform, pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../workspace/shared/renderLayerPipeline'
import { requiresCompositionVideoRenderer } from './previewRendererSelection'
import { compositionTimeForVideoLayer } from './previewLayerTiming'
import { usePreviewResolution } from './usePreviewResolution'
import {
  buildLayers,
  calcAspectRatio,
  projectCanvasFor,
} from './previewStageGeometry'
import type { PreviewStageHandle, PreviewStageProps } from './previewStageTypes'
import './PreviewStage.css'

const PREVIEW_LOADING_TIMEOUT_MS = 12_000
export { buildLayers, calcAspectRatio } from './previewStageGeometry'
export type { MediaResolution } from './previewStageGeometry'
export type { PreviewStageHandle, PreviewStageProps } from './previewStageTypes'
export const PreviewStage = forwardRef<PreviewStageHandle, PreviewStageProps>(
  function PreviewStage(
    { url, active = true, isLivePhoto: isLivePhotoOverride, pending = false, extraLayers, pipeline, maskProjectId, cropActive, hideControls, onMetricsChange, onMediaSize, renderOverlay, viewScale = 'fit', onViewScaleChange, onFitScaleChange, viewportKey, previewMaxSide = 1440, keepCompositionVideoRenderer = false, previewRenderer = 'native', onPlayStateChange }: PreviewStageProps,
    ref,
  ) {
  const { settings, setSettings } = useApp()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // ── 媒体分辨率 ──
  // ── 加载状态（url 切换时自动 loading） ──
  const [loading, setLoading] = useState(false)
  const [renderedCanvasKey, setRenderedCanvasKey] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewErrorToastRef = useRef<string | null>(null)
  const prevUrlRef = useRef<string | null>(null)
  // ── 视频控件状态 ──
  const videoRef = useRef<HTMLMediaElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [nativePreviewFailed, setNativePreviewFailed] = useState(false)
  const nativePreviewAutoDisabledRef = useRef(false)
  const gpuPreviewEnabled = settings?.experimentalGpuPreview ?? false
  const webGpuPreviewEnabled = settings?.experimentalWebGpuPreview ?? false
  const [webGpuPreviewFailed, setWebGpuPreviewFailed] = useState(false)
  const webGpuPreviewAutoDisabledRef = useRef(false)
  const detectedLivePhoto = useIsLivePhoto(isLivePhotoOverride === undefined ? url : null)
  const isLivePhoto = isLivePhotoOverride ?? detectedLivePhoto
  const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(null)
  const [liveVideoLoading, setLiveVideoLoading] = useState(false)
  const [livePlaying, setLivePlaying] = useState(false)
  const playbackIntentRef = useRef(false)
  const wasPlayingBeforeSeekRef = useRef(false) // 记录 seek 前是否在播放
  const shouldResumePlaybackRef = useRef(false) // 记录是否需要在渲染完成后恢复播放
  const displayUrl = livePlaying && liveVideoUrl ? liveVideoUrl : url
  const isDisplayVideo = displayUrl ? isVideoPath(displayUrl) : false
  const layoutUrl = livePlaying && liveVideoUrl ? url : displayUrl
  const resolution = usePreviewResolution(layoutUrl)
  useEffect(() => {
    setNativePreviewFailed(false)
    setWebGpuPreviewFailed(false)
    if (!gpuPreviewEnabled) nativePreviewAutoDisabledRef.current = false
    if (!webGpuPreviewEnabled) webGpuPreviewAutoDisabledRef.current = false
  }, [gpuPreviewEnabled, previewRenderer, webGpuPreviewEnabled])
  // 暴露给父组件的视频控制 API
  useImperativeHandle(ref, () => ({
    seek: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = time
      setCurrentTime(time)
    },
    togglePlay: () => {
      if (!videoRef.current) return
      shouldResumePlaybackRef.current = false
      if (playing) {
        playbackIntentRef.current = false
        videoRef.current.pause()
      } else {
        playbackIntentRef.current = true
        videoRef.current.play().catch(() => {})
      }
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? currentTime,
    getDuration: () => videoRef.current?.duration ?? duration,
    isPlaying: () => videoRef.current ? !videoRef.current.paused : playing,
  }), [currentTime, duration, playing])

  // 暴露 video 元素并绑定事件
  const handleVideoElement = useCallback((el: HTMLMediaElement | null) => {
    if (videoRef.current === el) return
    // 解绑旧元素
    if (videoRef.current) {
      videoRef.current.onplay = null
      videoRef.current.onpause = null
      videoRef.current.ontimeupdate = null
      videoRef.current.onloadedmetadata = null
      videoRef.current.onended = null
    }
    videoRef.current = el
    if (el) {
      playbackIntentRef.current = !el.paused
      setPlaying(playbackIntentRef.current)
      setCurrentTime(el.currentTime)
      setDuration(el.duration || 0)
      el.onplay = () => {
        if (!playbackIntentRef.current) {
          el.pause()
          return
        }
        setPlaying(true)
        onPlayStateChange?.({ playing: true, currentTime: el.currentTime, duration: el.duration || 0 })
      }
      el.onpause = () => {
        playbackIntentRef.current = false
        setPlaying(false)
        onPlayStateChange?.({ playing: false, currentTime: el.currentTime, duration: el.duration || 0 })
      }
      el.ontimeupdate = () => {
        setCurrentTime(el.currentTime)
        onPlayStateChange?.({ playing: !el.paused, currentTime: el.currentTime, duration: el.duration || 0 })
      }
      el.onloadedmetadata = () => {
        setDuration(el.duration || 0)
        onPlayStateChange?.({ playing: !el.paused, currentTime: el.currentTime, duration: el.duration || 0 })
      }
      el.onended = () => {
        shouldResumePlaybackRef.current = false
        playbackIntentRef.current = false
        setPlaying(false)
        setCurrentTime(el.duration || el.currentTime)
        if (livePlaying) setLivePlaying(false)
        onPlayStateChange?.({ playing: false, currentTime: el.duration || el.currentTime, duration: el.duration || 0 })
      }
      if (livePlaying && isDisplayVideo) {
        playbackIntentRef.current = true
        el.currentTime = 0
        el.play().catch(() => {})
      }
    } else {
      playbackIntentRef.current = false
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)
    }
  }, [isDisplayVideo, livePlaying, onPlayStateChange])

  useEffect(() => {
    let canceled = false
    setNativePreviewFailed(false)
    setLivePlaying(false)
    setLiveVideoUrl(null)
    if (!isLivePhoto || !url) return

    setLiveVideoLoading(true)
    window.luna.previewLivePhoto(url)
      .then((result) => {
        if (!canceled) setLiveVideoUrl(result.source ?? null)
      })
      .catch(() => {
        if (!canceled) setLiveVideoUrl(null)
      })
      .finally(() => {
        if (!canceled) setLiveVideoLoading(false)
      })

    return () => {
      canceled = true
    }
  }, [url, isLivePhoto])

  function togglePlay() {
    if (!videoRef.current) return
    shouldResumePlaybackRef.current = false
    if (!playing) {
      playbackIntentRef.current = true
      videoRef.current.play().catch(() => {})
    } else {
      playbackIntentRef.current = false
      videoRef.current.pause()
    }
  }

  function handleSeek(time: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
    // 每次都更新 currentTime，确保进度条和时间显示同步
    setCurrentTime(time)
  }

  function handleSeekStart() {
    // 拖动开始时，如果正在播放，暂停视频
    if (videoRef.current && !videoRef.current.paused) {
      wasPlayingBeforeSeekRef.current = true
      playbackIntentRef.current = false
      videoRef.current.pause()
    } else {
      wasPlayingBeforeSeekRef.current = false
    }
    shouldResumePlaybackRef.current = false
    setLoading(true)
  }

  function handleSeekEnd() {
    // 拖动结束时，不立即恢复播放，等待渲染完成
    if (wasPlayingBeforeSeekRef.current) {
      shouldResumePlaybackRef.current = true
    }
    // loading 会在渲染完成后通过 onRender 回调自动取消
  }

  function toggleLivePhoto() {
    if (!liveVideoUrl) return
    setLivePlaying((current) => !current)
  }

  useEffect(() => {
    if (!livePlaying || !isDisplayVideo || !videoRef.current) return
    playbackIntentRef.current = true
    videoRef.current.currentTime = 0
    videoRef.current.play().catch(() => {})
  }, [livePlaying, isDisplayVideo, displayUrl])

  // url 变化时显示 loading，onRender 时取消
  useEffect(() => {
    if (!displayUrl) { setLoading(false); return }
    if (displayUrl !== prevUrlRef.current) {
      prevUrlRef.current = displayUrl
      setLoading(true)
    }
  }, [displayUrl])

  useEffect(() => {
    if (pending) setLoading(true)
  }, [pending])

  // 宽高比（由 resolution 派生）
  const aspectRatio = useMemo(() => {
    if (!resolution) return null
    return calcAspectRatio(resolution.width, resolution.height)
  }, [resolution])
  const previewCanvas = useMemo(
    () => projectCanvasFor(
      resolution && pipeline ? outputSizeForTransform(resolution, pipeline.transform) : resolution,
      Math.min(3840, Math.max(1, previewMaxSide)),
    ),
    [pipeline, previewMaxSide, resolution],
  )

  const canvasRenderKey = previewCanvas && displayUrl
    ? `${displayUrl}\n${previewCanvas.width}x${previewCanvas.height}`
    : null
  // 切换素材或画布尺寸时销毁旧渲染实例，避免旧的异步渲染结果回写当前 loading 状态。
  const rendererKey = canvasRenderKey ?? 'empty'
  const canvasAwaitingRender = canvasRenderKey !== null && renderedCanvasKey !== canvasRenderKey

  function handleRender() {
    previewErrorToastRef.current = null
    setPreviewError(null)
    setRenderedCanvasKey(canvasRenderKey)
    setLoading(false)
    // 裁剪模式会在“最终裁剪画布”和“原始工作画布”之间切换。
    // 渲染完成后再读取 canvas 的真实 DOM 尺寸，避免遮罩沿用切换前的比例。
    window.requestAnimationFrame(syncCanvasMetrics)
    // 渲染完成后，检查是否需要恢复播放
    if (shouldResumePlaybackRef.current && videoRef.current) {
      shouldResumePlaybackRef.current = false
      playbackIntentRef.current = true
      videoRef.current.play().catch(() => {})
    }
  }

  function handleRenderFailure(reason: string, showToast = true) {
    console.warn('[PreviewStage] preview render failed', { reason })
    if (showToast && previewErrorToastRef.current !== reason) {
      previewErrorToastRef.current = reason
      toast.error('预览暂时无法显示，请重试或重置当前素材')
    }
    setPreviewError(reason)
    setRenderedCanvasKey(canvasRenderKey)
    setLoading(false)
    shouldResumePlaybackRef.current = false
  }

  function handleNativePreviewFailure(reason: string) {
    handleRenderFailure(reason)
    setNativePreviewFailed(true)
    if (nativePreviewAutoDisabledRef.current || !settings?.experimentalGpuPreview) return

    // Keep an incompatible Windows GPU from selecting the failing preview path again.
    nativePreviewAutoDisabledRef.current = true
    setSettings((current) => (current ? { ...current, experimentalGpuPreview: false } : current))
    void window.luna.saveSettings({ experimentalGpuPreview: false }).catch(() => undefined)
  }

  function handleWebGpuPreviewFailure(reason: string) {
    console.warn('[PreviewStage] WebGPU preview fallback', { reason })
    setWebGpuPreviewFailed(true)
    handleRenderFailure(reason, false)
    if (previewErrorToastRef.current !== reason) {
      previewErrorToastRef.current = reason
      toast.error('WebGPU 预览暂不可用，已切回通用预览')
    }
    if (webGpuPreviewAutoDisabledRef.current || !settings?.experimentalWebGpuPreview) return
    webGpuPreviewAutoDisabledRef.current = true
    setSettings((current) => (current ? { ...current, experimentalWebGpuPreview: false } : current))
    void window.luna.saveSettings({ experimentalWebGpuPreview: false }).catch(() => undefined)
  }

  useEffect(() => {
    previewErrorToastRef.current = null
    setPreviewError(null)
  }, [displayUrl])

  useEffect(() => {
    if (!loading && !canvasAwaitingRender) return
    const timeout = window.setTimeout(() => {
      console.warn('[PreviewStage] preview loading timed out', { canvasRenderKey })
      setRenderedCanvasKey(canvasRenderKey)
      setLoading(false)
      shouldResumePlaybackRef.current = false
    }, PREVIEW_LOADING_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [canvasAwaitingRender, canvasRenderKey, loading])

  const restoreLutFilePath = pipeline?.logRestore?.activeId ?? undefined
  const lutFilePath = pipeline?.lutFilter?.activeId ?? undefined

  const buildAdjustedLayers = useCallback((sourceUrl: string | null): PreviewLayer[] => {
    // 输出画布已经采用裁剪后的比例，媒体层应填满画布，再由渲染变换取出裁剪区域。
    const main = sourceUrl ? buildLayers(sourceUrl) : []
    const canvasFrame = main[0]
    if (canvasFrame && pipeline) {
      const styledMain = {
        ...canvasFrame,
        color: pipelineColorToRenderColor(pipeline.color),
        transform: pipelineTransformToRenderTransform(pipeline.transform),
        restoreLutId: restoreLutFilePath,
        lutId: lutFilePath,
        lutIntensity: pipeline?.lutFilter?.intensity ?? 100,
        ...(pipeline.trim?.startTime != null ? { videoTime: pipeline.trim.startTime } : {}),
        ...(pipeline.trim ? { videoDuration: pipeline.trim.endTime - pipeline.trim.startTime } : {}),
      }
      main[0] = cropActive
        ? styledMain
        : applyBorderMediaLayout(styledMain, pipeline.border)
      main.splice(0, 1, ...buildLocalColorPrecomposition(main[0], pipeline, 'workspace-local-color')
        .map((layer) => ({ ...layer, maskProjectId })))
    }
    const m = main[0]
    if (!m) {
      if (extraLayers?.length) {
        console.log('[PreviewStage] skip overlay-only render', { sourceUrl, extraLayers: extraLayers.length })
      }
      return main
    }
    if (!extraLayers?.length) return main

    const cX = canvasFrame?.dstX ?? 0
    const cY = canvasFrame?.dstY ?? 0
    const cW = canvasFrame?.dstW ?? 1
    const cH = canvasFrame?.dstH ?? 1
    const adjusted = extraLayers.map((l) => ({
      ...l,
      maskProjectId: l.maskPath || l.maskTimeline ? maskProjectId : l.maskProjectId,
      dstX: cX + l.dstX * cW,
      dstY: cY + l.dstY * cH,
      dstW: l.dstW * cW,
      dstH: l.dstH * cH,
    }))
    return [...main, ...adjusted]
  }, [cropActive, extraLayers, pipeline, restoreLutFilePath, lutFilePath, maskProjectId])

  const layers = useMemo(() => {
    if (pending || !resolution) return []
    return buildAdjustedLayers(displayUrl)
  }, [buildAdjustedLayers, displayUrl, resolution, livePlaying, pending])
  const useCompositionVideoRenderer = requiresCompositionVideoRenderer(
    isDisplayVideo,
    layers,
    keepCompositionVideoRenderer,
  )
  const useNativeGpuPreview = isDisplayVideo
    && previewRenderer !== 'webgpu'
    && gpuPreviewEnabled
    && !webGpuPreviewEnabled
    && !livePlaying
    && !useCompositionVideoRenderer
    && !cropActive
    && viewScale === 'fit'
    && !nativePreviewFailed
  const useWebGpuPreview = (previewRenderer === 'webgpu' || webGpuPreviewEnabled)
    && !webGpuPreviewFailed
    && !livePlaying
    && !useCompositionVideoRenderer
    && Boolean(previewCanvas)
  const primaryVideoLayer = layers.find((layer) => layer.isVideo)
  const compositionTime = primaryVideoLayer
    ? compositionTimeForVideoLayer(primaryVideoLayer, currentTime)
    : Math.max(0, currentTime)

  const syncCanvasMetrics = useCallback(() => {
    const stage = stageRef.current
    const wrapper = wrapperRef.current
    const canvas = wrapper?.querySelector('canvas')
    if (!stage || !canvas || !resolution) return
    const stageRect = stage.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    if (canvas.width > 0 && canvas.height > 0) {
      const fitScale = Math.min(canvas.clientWidth / canvas.width, canvas.clientHeight / canvas.height)
      if (Number.isFinite(fitScale) && fitScale > 0) onFitScaleChange?.(Math.round(fitScale * 100))
    }
    onMetricsChange?.({
      sourceAspect: resolution.width / resolution.height,
      imageRect: {
        x: canvasRect.left - stageRect.left,
        y: canvasRect.top - stageRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      },
    })
  }, [onFitScaleChange, onMetricsChange, resolution])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const observer = new ResizeObserver(syncCanvasMetrics)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [syncCanvasMetrics])

  useEffect(() => {
    if (!resolution) return
    onMediaSize?.(resolution.width, resolution.height)
  }, [resolution, onMediaSize])

  useEffect(() => {
    const stage = stageRef.current
    const wrapper = wrapperRef.current
    const mainLayer = layers[0]
    if (!stage || !wrapper || !resolution || !mainLayer) return

    const stageRect = stage.getBoundingClientRect()
    // 使用 canvas 实际渲染位置，而非 project canvas 的 letterbox 计算。
    // canvas 在 DOM 中会被 CSS max-width/max-height 居中/缩放，
    // 与 project canvas 尺寸不一定一致，直接读 DOM 坐标更准确。
    const canvas = wrapper.querySelector('canvas')
    if (canvas) {
      syncCanvasMetrics()
    } else {
      const wrapperRect = wrapper.getBoundingClientRect()
      onMetricsChange?.({
        sourceAspect: resolution.width / resolution.height,
        imageRect: {
          x: wrapperRect.left - stageRect.left + mainLayer.dstX * wrapperRect.width,
          y: wrapperRect.top - stageRect.top + mainLayer.dstY * wrapperRect.height,
          width: mainLayer.dstW * wrapperRect.width,
          height: mainLayer.dstH * wrapperRect.height,
        },
      })
    }
  }, [onMetricsChange, layers, resolution, syncCanvasMetrics, viewScale])

  if (!displayUrl && layers.length === 0) return null

  return (
    <div
      ref={stageRef}
      className="preview-stage ui-video-controls-host"
      data-crop-active={cropActive ? '' : undefined}
      data-media-aspect-ratio={aspectRatio ?? undefined}
    >
      {layers.length > 0 && (
        <div ref={wrapperRef} className="preview-canvas-wrapper">
          {useWebGpuPreview && previewCanvas ? (
            <WebGpuVideoPreview
              key={rendererKey}
              layers={layers}
              canvasWidth={previewCanvas.width}
              canvasHeight={previewCanvas.height}
              maxSide={Math.min(3840, Math.max(1, previewMaxSide))}
              active={active}
              playing={playing}
              time={compositionTime}
              imageScale={viewScale === 'fit' ? null : viewScale / 100}
              onRender={handleRender}
              onVideoElement={handleVideoElement}
              onFallback={handleWebGpuPreviewFailure}
            />
          ) : useNativeGpuPreview && previewCanvas ? (
            <NativeGpuVideoPreview
              layers={layers}
              canvasWidth={previewCanvas.width}
              canvasHeight={previewCanvas.height}
              active={active}
              playing={playing}
              time={compositionTime}
              onRender={handleRender}
              onVideoElement={handleVideoElement}
              onFallback={(reason) => {
                console.warn('[PreviewStage] native GPU preview fallback', { reason })
                handleNativePreviewFailure(reason)
              }}
            />
          ) : isDisplayVideo && !useCompositionVideoRenderer ? (
            <MultipleLayerVideoPreviewLrcRender
              key={rendererKey}
              layers={layers}
              canvasWidth={previewCanvas?.width}
              canvasHeight={previewCanvas?.height}
              maxSide={Math.min(3840, Math.max(1, previewMaxSide))}
              playing={playing}
              onError={handleRenderFailure}
              onRender={handleRender}
              onVideoElement={handleVideoElement}
              imageScale={viewScale === 'fit' ? null : viewScale / 100}
              onImageScaleChange={(scale) => onViewScaleChange?.(scale == null ? 'fit' : Math.round(scale * 100))}
              interactiveImageLayerIndexes={cropActive ? [] : layers.length > 0 ? [0] : []}
              viewportKey={viewportKey}
            />
          ) : (
            <LrcRender
              key={rendererKey}
              layers={layers}
              canvasWidth={previewCanvas?.width}
              canvasHeight={previewCanvas?.height}
              maxSide={previewCanvas ? Math.max(previewCanvas.width, previewCanvas.height) : undefined}
              compositionTime={compositionTime}
              interactiveImageLayerIndexes={cropActive ? [] : layers.length > 0 ? [0] : []}
              viewportKey={viewportKey}
              imageScale={viewScale === 'fit' ? null : viewScale / 100}
              onImageScaleChange={(scale) => onViewScaleChange?.(scale == null ? 'fit' : Math.round(scale * 100))}
              onViewportChange={syncCanvasMetrics}
              onError={handleRenderFailure}
              onRender={handleRender}
              onVideoElement={handleVideoElement}
            />
          )}
        </div>
      )}
      {renderOverlay?.()}
      {previewError && <PreviewStageError detail={previewError} />}
      {(loading || canvasAwaitingRender) && (
        <div className="preview-loading-overlay">
          <div className="preview-loading-spinner" />
        </div>
      )}
      {isLivePhoto && (
        <LivePhotoBadge
          size={32}
          onClick={toggleLivePhoto}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLivePhoto() } }}
          aria-label={livePlaying ? '停止 Live 图播放' : '播放 Live 图'}
          style={{
            position: 'absolute',
            left: 18,
            bottom: 18,
            cursor: liveVideoLoading || !liveVideoUrl ? 'wait' : 'pointer',
            opacity: liveVideoLoading || !liveVideoUrl ? 0.72 : 1,
          }}
        />
      )}
      {isDisplayVideo && !livePlaying && videoRef.current && !hideControls && (
        <VideoControls
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          onToggle={togglePlay}
          onSeek={handleSeek}
          onSeekStart={handleSeekStart}
          onSeekEnd={handleSeekEnd}
        />
      )}
    </div>
  )
})
