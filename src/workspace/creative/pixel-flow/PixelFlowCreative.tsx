import { ArrowLeft, Play, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LrcRender } from '../../../components/LrcRender'
import { NativeGpuVideoPreview } from '../../../components/NativeGpuVideoPreview'
import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { type PixelFlowSubjectDirection, type PreviewLayer, type WorkspacePixelFlowState } from '../../../shared/types'
import { Button, LoadingIndicator, VideoControls, toast } from '../../../ui'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import type { CreativeModuleProps } from '../creativeCatalog'
import { loadCreativeImageSize } from '../shared/creativeMedia'
import { PixelFlowControls } from './PixelFlowControls'
import { combinePixelFlowDepthMask, type PixelFlowMask } from './pixelFlowRender'
import { buildPixelFlowLayer, type PixelFlowEffectSettings } from './pixelFlowLayers'
import {
  DEFAULT_PIXEL_FLOW_BLOOM,
  DEFAULT_PIXEL_FLOW_COLOR_TRANSITION,
  DEFAULT_PIXEL_FLOW_COUNT,
  DEFAULT_PIXEL_FLOW_DURATION,
  DEFAULT_PIXEL_FLOW_FILTER,
  DEFAULT_PIXEL_FLOW_FLOW_STRENGTH,
  DEFAULT_PIXEL_FLOW_INITIAL_BRIGHTNESS,
  DEFAULT_PIXEL_FLOW_INITIAL_SATURATION,
  DEFAULT_PIXEL_FLOW_RAIN_LENGTH,
  DEFAULT_PIXEL_FLOW_RAIN_SPEED,
  DEFAULT_PIXEL_FLOW_SUBJECT_DELAY,
  DEFAULT_PIXEL_FLOW_SUBJECT_DIRECTION,
  DEFAULT_PIXEL_FLOW_WIDTH,
  PIXEL_FLOW_SETTINGS_VERSION,
} from './pixelFlowPresets'
import { pixelFlowStateForAsset, savedPixelFlowParameter, savedPixelFlowSubjectDirection } from './pixelFlowState'
import { PIXEL_FLOW_LIVE_DURATION } from './pixelFlowExport'
import { usePixelFlowBatchExport } from './usePixelFlowBatchExport'
import './pixel-flow.css'

export function PixelFlowCreative({ onBack, supportedMediaKinds }: CreativeModuleProps) {
  const media = useWorkspaceMedia()
  const activeAsset = media.activeMedia
  const activeAssetId = activeAsset?.id
  const projectId = media.currentProject?.id
  const saved = pixelFlowStateForAsset(media.currentProject, activeAssetId)
  const [duration, setDuration] = useState(savedPixelFlowParameter(saved, 'duration', DEFAULT_PIXEL_FLOW_DURATION))
  const [pixelCount, setPixelCount] = useState(savedPixelFlowParameter(saved, 'pixelCount', DEFAULT_PIXEL_FLOW_COUNT))
  const [lightWidth, setLightWidth] = useState(savedPixelFlowParameter(saved, 'lightWidth', DEFAULT_PIXEL_FLOW_WIDTH))
  const [initialSaturation, setInitialSaturation] = useState(savedPixelFlowParameter(saved, 'initialSaturation', DEFAULT_PIXEL_FLOW_INITIAL_SATURATION))
  const [initialBrightness, setInitialBrightness] = useState(savedPixelFlowParameter(saved, 'initialBrightness', DEFAULT_PIXEL_FLOW_INITIAL_BRIGHTNESS))
  const [subjectDirection, setSubjectDirection] = useState<PixelFlowSubjectDirection>(savedPixelFlowSubjectDirection(saved, DEFAULT_PIXEL_FLOW_SUBJECT_DIRECTION))
  const [bloomStrength, setBloomStrength] = useState(savedPixelFlowParameter(saved, 'bloomStrength', DEFAULT_PIXEL_FLOW_BLOOM))
  const [filterStrength, setFilterStrength] = useState(savedPixelFlowParameter(saved, 'filterStrength', DEFAULT_PIXEL_FLOW_FILTER))
  const [colorTransition, setColorTransition] = useState(savedPixelFlowParameter(saved, 'colorTransition', DEFAULT_PIXEL_FLOW_COLOR_TRANSITION))
  const [rainSpeed, setRainSpeed] = useState(savedPixelFlowParameter(saved, 'rainSpeed', DEFAULT_PIXEL_FLOW_RAIN_SPEED))
  const [rainLength, setRainLength] = useState(savedPixelFlowParameter(saved, 'rainLength', DEFAULT_PIXEL_FLOW_RAIN_LENGTH))
  const [flowStrength, setFlowStrength] = useState(savedPixelFlowParameter(saved, 'flowStrength', DEFAULT_PIXEL_FLOW_FLOW_STRENGTH))
  const [subjectDelay, setSubjectDelay] = useState(savedPixelFlowParameter(saved, 'subjectDelay', DEFAULT_PIXEL_FLOW_SUBJECT_DELAY))
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskPath ?? null)
  const [skyMaskPath, setSkyMaskPath] = useState<string | null>(saved?.skyMaskPath ?? null)
  const [depthMaskPath, setDepthMaskPath] = useState<string | null>(saved?.depthMaskPath ?? null)
  const [subjectMask, setSubjectMask] = useState<PixelFlowMask | null>(null)
  const [skyMask, setSkyMask] = useState<PixelFlowMask | null>(null)
  const [segmenting, setSegmenting] = useState(false)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [mediaDuration, setMediaDuration] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [gpuFallback, setGpuFallback] = useState(false)
  const [seekRevision, setSeekRevision] = useState(0)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const requestRef = useRef(new Set<string>())
  const operationRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)
  const depthBuildRef = useRef<string | null>(null)

  useEffect(() => {
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
    operationRef.current = null
    const restored = pixelFlowStateForAsset(media.currentProject, activeAssetId)
    setDuration(savedPixelFlowParameter(restored, 'duration', DEFAULT_PIXEL_FLOW_DURATION))
    setPixelCount(savedPixelFlowParameter(restored, 'pixelCount', DEFAULT_PIXEL_FLOW_COUNT))
    setLightWidth(savedPixelFlowParameter(restored, 'lightWidth', DEFAULT_PIXEL_FLOW_WIDTH))
    setInitialSaturation(savedPixelFlowParameter(restored, 'initialSaturation', DEFAULT_PIXEL_FLOW_INITIAL_SATURATION))
    setInitialBrightness(savedPixelFlowParameter(restored, 'initialBrightness', DEFAULT_PIXEL_FLOW_INITIAL_BRIGHTNESS))
    setSubjectDirection(savedPixelFlowSubjectDirection(restored, DEFAULT_PIXEL_FLOW_SUBJECT_DIRECTION))
    setBloomStrength(savedPixelFlowParameter(restored, 'bloomStrength', DEFAULT_PIXEL_FLOW_BLOOM))
    setFilterStrength(savedPixelFlowParameter(restored, 'filterStrength', DEFAULT_PIXEL_FLOW_FILTER))
    setColorTransition(savedPixelFlowParameter(restored, 'colorTransition', DEFAULT_PIXEL_FLOW_COLOR_TRANSITION))
    setRainSpeed(savedPixelFlowParameter(restored, 'rainSpeed', DEFAULT_PIXEL_FLOW_RAIN_SPEED))
    setRainLength(savedPixelFlowParameter(restored, 'rainLength', DEFAULT_PIXEL_FLOW_RAIN_LENGTH))
    setFlowStrength(savedPixelFlowParameter(restored, 'flowStrength', DEFAULT_PIXEL_FLOW_FLOW_STRENGTH))
    setSubjectDelay(savedPixelFlowParameter(restored, 'subjectDelay', DEFAULT_PIXEL_FLOW_SUBJECT_DELAY))
    setMaskPath(restored?.maskPath ?? null)
    setSkyMaskPath(restored?.skyMaskPath ?? null)
    setDepthMaskPath(restored?.depthMaskPath ?? null)
    setSubjectMask(null)
    setSkyMask(null)
    setSegmenting(false)
    setSourceSize(null)
    setMediaDuration(null)
    setCurrentTime(0)
    setPlaying(false)
    setGpuFallback(false)
    setSeekRevision((revision) => revision + 1)
    attemptedAssetRef.current = null
    depthBuildRef.current = null
  // Only restore when the selected asset or project changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetId, projectId])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    if (maskPath) window.luna.workspace.loadColorMask(projectId, maskPath).then((loaded) => {
      if (!cancelled) setSubjectMask({ data: new Uint8Array(loaded.bytes), width: loaded.width, height: loaded.height })
    }).catch(() => { if (!cancelled) setMaskPath(null) })
    else setSubjectMask(null)
    if (skyMaskPath) window.luna.workspace.loadColorMask(projectId, skyMaskPath).then((loaded) => {
      if (!cancelled) setSkyMask({ data: new Uint8Array(loaded.bytes), width: loaded.width, height: loaded.height })
    }).catch(() => { if (!cancelled) setSkyMaskPath(null) })
    else setSkyMask(null)
    return () => { cancelled = true }
  }, [maskPath, projectId, skyMaskPath])

  useEffect(() => {
    if (!projectId || !activeAssetId || !subjectMask || !skyMask || depthMaskPath) return
    const buildKey = `${activeAssetId}:${maskPath ?? ''}:${skyMaskPath ?? ''}`
    if (depthBuildRef.current === buildKey) return
    depthBuildRef.current = buildKey
    const combined = combinePixelFlowDepthMask(subjectMask, skyMask)
    window.luna.workspace.saveColorMask(
      projectId,
      `${activeAssetId}-pixel-flow-depth`,
      combined.width,
      combined.height,
      combined.data,
      1,
    ).then((savedDepth) => {
      if (depthBuildRef.current === buildKey) setDepthMaskPath(savedDepth.path)
    }).catch(() => {
      if (depthBuildRef.current === buildKey) {
        depthBuildRef.current = null
        toast.error('无法准备画面层次')
      }
    })
  }, [activeAssetId, depthMaskPath, maskPath, projectId, skyMask, skyMaskPath, subjectMask])

  useEffect(() => {
    if (!activeAsset) return
    let cancelled = false
    Promise.all([
      activeAsset.kind === 'image'
        ? loadCreativeImageSize(activeAsset)
        : window.luna.workspace.getMediaResolution(activeAsset.path),
      activeAsset.kind === 'video' ? window.luna.workspace.getVideoDuration(activeAsset.path) : Promise.resolve(null),
    ]).then(([size, sourceDuration]) => {
      if (cancelled) return
      setSourceSize(size)
      setMediaDuration(sourceDuration)
      setCurrentTime(0)
      setPlaying(false)
      setSeekRevision((revision) => revision + 1)
    }).catch(() => { if (!cancelled) toast.error('无法读取素材信息') })
    return () => { cancelled = true }
  }, [activeAsset])

  const segmentScene = useCallback(async () => {
    if (!activeAsset || !media.currentProject || segmenting) return
    const operationId = crypto.randomUUID()
    const frameTime = activeAsset.kind === 'video' ? 0 : undefined
    operationRef.current = operationId
    setPlaying(false)
    setCurrentTime(0)
    setDepthMaskPath(null)
    setSubjectMask(null)
    setSkyMask(null)
    depthBuildRef.current = null
    setSegmenting(true)
    const subjectRequestId = `${operationId}-subject`
    const skyRequestId = `${operationId}-sky`
    try {
      requestRef.current.add(subjectRequestId)
      const subjectResult = await window.luna.workspace.segmentImage({
        requestId: subjectRequestId,
        filePath: activeAsset.path,
        frameTime,
        targetId: 'subject',
      })
      requestRef.current.delete(subjectRequestId)
      if (operationRef.current !== operationId) return
      const subjectData = new Uint8Array(subjectResult.bytes)
      const savedSubject = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        `${activeAsset.id}-pixel-flow-subject`,
        subjectResult.width,
        subjectResult.height,
        subjectData,
        1,
      )
      if (operationRef.current !== operationId) return
      setSubjectMask({ data: subjectData, width: subjectResult.width, height: subjectResult.height })
      setMaskPath(savedSubject.path)

      let skyWidth = subjectResult.width
      let skyHeight = subjectResult.height
      let skyData = new Uint8Array(skyWidth * skyHeight)
      try {
        requestRef.current.add(skyRequestId)
        const skyResult = await window.luna.workspace.segmentImage({
          requestId: skyRequestId,
          filePath: activeAsset.path,
          frameTime,
          targetId: 'sky',
        })
        if (operationRef.current !== operationId) return
        skyWidth = skyResult.width
        skyHeight = skyResult.height
        skyData = new Uint8Array(skyResult.bytes)
      } catch {
        if (operationRef.current !== operationId) return
        // 没有天空或天空识别不可用时，主体和普通背景仍然可以生成完整效果。
      } finally {
        requestRef.current.delete(skyRequestId)
      }
      const savedSky = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        `${activeAsset.id}-pixel-flow-sky`,
        skyWidth,
        skyHeight,
        skyData,
        1,
      )
      if (operationRef.current !== operationId) return
      setSkyMask({ data: skyData, width: skyWidth, height: skyHeight })
      setSkyMaskPath(savedSky.path)
    } catch (error) {
      if (operationRef.current === operationId) {
        toast.error(error instanceof Error ? error.message : '画面识别失败')
      }
    } finally {
      requestRef.current.delete(subjectRequestId)
      requestRef.current.delete(skyRequestId)
      if (operationRef.current === operationId) {
        operationRef.current = null
        setSegmenting(false)
      }
    }
  }, [activeAsset, media.currentProject, segmenting])

  const playbackDuration = activeAsset?.kind === 'video' ? mediaDuration ?? duration : duration

  useEffect(() => {
    if (!activeAsset || depthMaskPath || (maskPath && skyMaskPath) || segmenting) return
    if (attemptedAssetRef.current === activeAsset.id) return
    attemptedAssetRef.current = activeAsset.id
    void segmentScene()
  }, [activeAsset, depthMaskPath, maskPath, segmentScene, segmenting, skyMaskPath])

  useEffect(() => {
    if (!depthMaskPath || !sourceSize || segmenting) {
      setPlaying(false)
      return
    }
    setCurrentTime(0)
    setPlaying(true)
    setSeekRevision((revision) => revision + 1)
  }, [depthMaskPath, segmenting, sourceSize])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId) return
    const state: WorkspacePixelFlowState = {
      settingsVersion: PIXEL_FLOW_SETTINGS_VERSION,
      duration,
      pixelCount,
      lightWidth,
      initialSaturation,
      initialBrightness,
      subjectDirection,
      bloomStrength,
      filterStrength,
      colorTransition,
      rainSpeed,
      rainLength,
      flowStrength,
      subjectDelay,
      maskPath: maskPath ?? undefined,
      skyMaskPath: skyMaskPath ?? undefined,
      depthMaskPath: depthMaskPath ?? undefined,
      maskAssetId: maskPath || skyMaskPath || depthMaskPath ? activeAssetId : undefined,
    }
    const nextProject = {
      ...project,
      creative: {
        ...project.creative,
        pixelFlow: state,
        pixelFlowByAssetId: {
          ...project.creative?.pixelFlowByAssetId,
          [activeAssetId]: state,
        },
      },
    }
    pendingProjectRef.current = nextProject
    media.setCurrentProject(nextProject)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    }, 300)
  // Project context refreshes are intentionally excluded from parameter persistence.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetId, bloomStrength, colorTransition, depthMaskPath, duration, filterStrength, flowStrength, initialBrightness, initialSaturation, lightWidth, maskPath, pixelCount, rainLength, rainSpeed, skyMaskPath, subjectDelay, subjectDirection])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
  }, [])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - previous) / 1000
      previous = now
      setCurrentTime((time) => {
        const next = Math.min(playbackDuration, time + elapsed)
        if (next >= playbackDuration) setPlaying(false)
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playbackDuration, playing])

  const effectSettings = useMemo<PixelFlowEffectSettings>(() => ({
    duration,
    pixelCount,
    lightWidth,
    initialSaturation,
    initialBrightness,
    subjectDirection,
    rainSpeed,
    rainLength,
    flowStrength,
    subjectDelay,
    bloomStrength,
    filterStrength,
    colorTransition,
  }), [bloomStrength, colorTransition, duration, filterStrength, flowStrength, initialBrightness, initialSaturation, lightWidth, pixelCount, rainLength, rainSpeed, subjectDelay, subjectDirection])

  const previewLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return [buildPixelFlowLayer({
      asset: activeAsset,
      maskPath: depthMaskPath ?? undefined,
      playbackDuration,
      settings: effectSettings,
    })]
  }, [activeAsset, depthMaskPath, effectSettings, playbackDuration, sourceSize])
  const gpuPreviewSize = useMemo(() => {
    if (!sourceSize) return null
    const scale = Math.min(1, 1080 / Math.max(sourceSize.width, sourceSize.height))
    return {
      width: Math.max(1, Math.round(sourceSize.width * scale)),
      height: Math.max(1, Math.round(sourceSize.height * scale)),
    }
  }, [sourceSize])
  const playbackReady = Boolean(sourceSize && depthMaskPath && !segmenting)
  const maskPreparing = Boolean(activeAsset && (!sourceSize || segmenting || !depthMaskPath))

  const replay = useCallback(() => {
    if (!playbackReady) return
    setCurrentTime(0)
    setPlaying(true)
    setSeekRevision((revision) => revision + 1)
  }, [playbackReady])

  function seek(time: number): void {
    if (!playbackReady) return
    setPlaying(false)
    setCurrentTime(time)
    setSeekRevision((revision) => revision + 1)
  }

  function resetParameters(): void {
    setDuration(DEFAULT_PIXEL_FLOW_DURATION)
    setPixelCount(DEFAULT_PIXEL_FLOW_COUNT)
    setLightWidth(DEFAULT_PIXEL_FLOW_WIDTH)
    setInitialSaturation(DEFAULT_PIXEL_FLOW_INITIAL_SATURATION)
    setInitialBrightness(DEFAULT_PIXEL_FLOW_INITIAL_BRIGHTNESS)
    setSubjectDirection(DEFAULT_PIXEL_FLOW_SUBJECT_DIRECTION)
    setBloomStrength(DEFAULT_PIXEL_FLOW_BLOOM)
    setFilterStrength(DEFAULT_PIXEL_FLOW_FILTER)
    setColorTransition(DEFAULT_PIXEL_FLOW_COLOR_TRANSITION)
    setRainSpeed(DEFAULT_PIXEL_FLOW_RAIN_SPEED)
    setRainLength(DEFAULT_PIXEL_FLOW_RAIN_LENGTH)
    setFlowStrength(DEFAULT_PIXEL_FLOW_FLOW_STRENGTH)
    setSubjectDelay(DEFAULT_PIXEL_FLOW_SUBJECT_DELAY)
    replay()
  }

  const handleError = useCallback((message: string) => toast.error(message), [])

  const { allowedFormats, exportableAssets, exporting, handleExport, hasImages: exportHasImages, initialConfig: exportInitialConfig } = usePixelFlowBatchExport({
    activeAsset,
    effectSettings,
    supportedMediaKinds,
    pendingProjectRef,
    onActiveMaskResolved: useCallback((paths) => {
      setMaskPath(paths.maskPath ?? null)
      setSkyMaskPath(paths.skyMaskPath ?? null)
      setDepthMaskPath(paths.depthMaskPath)
    }, []),
  })

  return <section className="pixel-flow-page">
    <header className="pixel-flow-toolbar">
      <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>返回</Button>
      <span>像素流光</span>
      <Button className="pixel-flow-replay" variant="toolbar" size="compact" icon={<Play size={14} />} disabled={!playbackReady} onClick={replay}>重播</Button>
    </header>
    <div className="pixel-flow-preview">
      {activeAsset ? <div className={`pixel-flow-stage${sourceSize ? sourceSize.width > sourceSize.height ? ' is-landscape' : ' is-portrait' : ''}`}>
        <div className="pixel-flow-render-surface">
          {previewLayers.length > 0 && gpuPreviewSize && (gpuFallback
            ? <LrcRender className="pixel-flow-canvas" layers={previewLayers} canvasWidth={gpuPreviewSize.width} canvasHeight={gpuPreviewSize.height} maxSide={1080} compositionTime={currentTime} interactiveImageLayerIndexes={[]} onError={handleError} />
            : <NativeGpuVideoPreview className="pixel-flow-canvas" layers={previewLayers} canvasWidth={gpuPreviewSize.width} canvasHeight={gpuPreviewSize.height} playing={playing} time={currentTime} seekRevision={seekRevision} onFallback={() => setGpuFallback(true)} />)}
        </div>
        {maskPreparing && <div className="pixel-flow-identifying" role="status"><LoadingIndicator /><span>生成中</span></div>}
        <VideoControls className="pixel-flow-controls" currentTime={currentTime} duration={playbackDuration} playing={playing} disabled={!playbackReady} onToggle={() => playing ? setPlaying(false) : replay()} onSeek={seek} step={1 / 60} />
      </div>
        : <div className="pixel-flow-empty"><ScanLine size={28} /><strong>选择图片或视频素材</strong><span>在下方素材栏中选择需要制作效果的素材</span></div>}
    </div>
    <PixelFlowControls
      duration={duration} pixelCount={pixelCount} lightWidth={lightWidth}
      initialSaturation={initialSaturation} initialBrightness={initialBrightness}
      subjectDirection={subjectDirection}
      generating={maskPreparing || exporting}
      disabled={!playbackReady} exporting={exporting}
      onDurationChange={setDuration} onPixelCountChange={setPixelCount} onLightWidthChange={setLightWidth}
      onInitialSaturationChange={setInitialSaturation} onInitialBrightnessChange={setInitialBrightness}
      onSubjectDirectionChange={setSubjectDirection}
      onReset={resetParameters} onExport={() => setExportDialogOpen(true)}
    />
    <div className="pixel-flow-media-strip"><WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} /></div>
    {activeAsset && sourceSize ? <ExportSettingsDialog
      open={exportDialogOpen}
      onOpenChange={setExportDialogOpen}
      title={exportableAssets.length > 1 ? `导出 ${exportableAssets.length} 个像素流光作品` : exportHasImages ? '导出像素流光' : '导出视频'}
      description={exportableAssets.length > 1 ? '每个素材使用自己的画面识别结果，缺失时会先自动生成。' : exportHasImages ? '可导出完整效果视频，也可同时生成 Live 图。' : undefined}
      loading={exporting}
      initialConfig={exportInitialConfig}
      allowedFormats={allowedFormats}
      livePhotoSource={exportHasImages ? {
        path: exportableAssets.find((asset) => asset.kind === 'image')?.path ?? activeAsset.path,
        startTime: 0,
        duration: PIXEL_FLOW_LIVE_DURATION,
        thumbnailDuration: PIXEL_FLOW_LIVE_DURATION,
        layers: previewLayers,
        outputSize: sourceSize,
      } : undefined}
      onConfirm={handleExport}
    /> : null}
  </section>
}
