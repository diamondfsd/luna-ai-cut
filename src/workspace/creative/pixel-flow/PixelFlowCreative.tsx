import { ArrowLeft, Play, RotateCcw, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LrcRender } from '../../../components/LrcRender'
import { NativeGpuVideoPreview } from '../../../components/NativeGpuVideoPreview'
import type { PreviewLayer, WorkspacePixelFlowState, WorkspaceProject } from '../../../shared/types'
import { Button, IconButton, LoadingIndicator, Select, VideoControls, toast } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import type { CreativeModuleProps } from '../creativeCatalog'
import { combinePixelFlowDepthMask, pixelFlowImpact, pixelFlowOrigin, pixelFlowRegionScales, pixelFlowSkyBlackRatio, type PixelFlowMask } from './pixelFlowRender'
import {
  DEFAULT_PIXEL_FLOW_BLOOM,
  DEFAULT_PIXEL_FLOW_COLOR_TRANSITION,
  DEFAULT_PIXEL_FLOW_COUNT,
  DEFAULT_PIXEL_FLOW_DURATION,
  DEFAULT_PIXEL_FLOW_FILTER,
  DEFAULT_PIXEL_FLOW_MODE,
  DEFAULT_PIXEL_FLOW_OTHER_DIRECTION,
  DEFAULT_PIXEL_FLOW_SEMANTIC_DELAY,
  DEFAULT_PIXEL_FLOW_SKY_MODE,
  DEFAULT_PIXEL_FLOW_TRAJECTORY,
  DEFAULT_PIXEL_FLOW_WIDTH,
  PIXEL_FLOW_MODE_OPTIONS,
  PIXEL_FLOW_OTHER_DIRECTION_OPTIONS,
  PIXEL_FLOW_SETTINGS_VERSION,
  PIXEL_FLOW_SKY_MODE_OPTIONS,
  PIXEL_FLOW_TRAJECTORY_OPTIONS,
} from './pixelFlowPresets'
import './pixel-flow.css'

type PixelFlowMode = NonNullable<WorkspacePixelFlowState['flowMode']>
type PixelFlowTrajectory = NonNullable<WorkspacePixelFlowState['trajectory']>
type PixelFlowSkyMode = NonNullable<WorkspacePixelFlowState['skyMode']>
type PixelFlowOtherDirection = NonNullable<WorkspacePixelFlowState['otherDirection']>

function savedParameter(
  saved: WorkspacePixelFlowState | undefined,
  key: 'duration' | 'pixelCount' | 'lightWidth' | 'semanticDelay' | 'bloomStrength' | 'filterStrength' | 'colorTransition',
  fallback: number,
): number {
  if (saved?.settingsVersion !== PIXEL_FLOW_SETTINGS_VERSION) return fallback
  return saved[key] ?? fallback
}

function stateForAsset(project: WorkspaceProject | null, assetId?: string): WorkspacePixelFlowState | undefined {
  if (!project || !assetId) return undefined
  const mapped = project.creative?.pixelFlowByAssetId?.[assetId]
  if (mapped) return mapped
  const legacy = project.creative?.pixelFlow
  return legacy?.maskAssetId === assetId ? legacy : undefined
}

export function PixelFlowCreative({ onBack, supportedMediaKinds }: CreativeModuleProps) {
  const media = useWorkspaceMedia()
  const activeAsset = media.activeMedia
  const activeAssetId = activeAsset?.id
  const projectId = media.currentProject?.id
  const saved = stateForAsset(media.currentProject, activeAssetId)
  const [duration, setDuration] = useState(savedParameter(saved, 'duration', DEFAULT_PIXEL_FLOW_DURATION))
  const [pixelCount, setPixelCount] = useState(savedParameter(saved, 'pixelCount', DEFAULT_PIXEL_FLOW_COUNT))
  const [lightWidth, setLightWidth] = useState(savedParameter(saved, 'lightWidth', DEFAULT_PIXEL_FLOW_WIDTH))
  const [semanticDelay, setSemanticDelay] = useState(savedParameter(saved, 'semanticDelay', DEFAULT_PIXEL_FLOW_SEMANTIC_DELAY))
  const [bloomStrength, setBloomStrength] = useState(savedParameter(saved, 'bloomStrength', DEFAULT_PIXEL_FLOW_BLOOM))
  const [filterStrength, setFilterStrength] = useState(savedParameter(saved, 'filterStrength', DEFAULT_PIXEL_FLOW_FILTER))
  const [colorTransition, setColorTransition] = useState(savedParameter(saved, 'colorTransition', DEFAULT_PIXEL_FLOW_COLOR_TRANSITION))
  const currentSettings = saved?.settingsVersion === PIXEL_FLOW_SETTINGS_VERSION
  const [flowMode, setFlowMode] = useState<PixelFlowMode>(currentSettings ? saved.flowMode ?? DEFAULT_PIXEL_FLOW_MODE : DEFAULT_PIXEL_FLOW_MODE)
  const [trajectory, setTrajectory] = useState<PixelFlowTrajectory>(currentSettings ? saved.trajectory ?? DEFAULT_PIXEL_FLOW_TRAJECTORY : DEFAULT_PIXEL_FLOW_TRAJECTORY)
  const [skyMode, setSkyMode] = useState<PixelFlowSkyMode>(saved?.skyMode ?? DEFAULT_PIXEL_FLOW_SKY_MODE)
  const [otherDirection, setOtherDirection] = useState<PixelFlowOtherDirection>(saved?.otherDirection ?? DEFAULT_PIXEL_FLOW_OTHER_DIRECTION)
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskPath ?? null)
  const [skyMaskPath, setSkyMaskPath] = useState<string | null>(saved?.skyMaskPath ?? null)
  const [depthMaskPath, setDepthMaskPath] = useState<string | null>(saved?.depthMaskPath ?? null)
  const [subjectMask, setSubjectMask] = useState<PixelFlowMask | null>(null)
  const [skyMask, setSkyMask] = useState<PixelFlowMask | null>(null)
  const [skyBlackRatio, setSkyBlackRatio] = useState(0)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const [gpuFallback, setGpuFallback] = useState(false)
  const [seekRevision, setSeekRevision] = useState(0)
  const requestRef = useRef(new Set<string>())
  const operationRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const depthBuildRef = useRef<string | null>(null)
  const isImage = activeAsset?.kind === 'image'

  useEffect(() => {
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
    operationRef.current = null
    const restored = stateForAsset(media.currentProject, activeAssetId)
    setDuration(savedParameter(restored, 'duration', DEFAULT_PIXEL_FLOW_DURATION))
    setPixelCount(savedParameter(restored, 'pixelCount', DEFAULT_PIXEL_FLOW_COUNT))
    setLightWidth(savedParameter(restored, 'lightWidth', DEFAULT_PIXEL_FLOW_WIDTH))
    setSemanticDelay(savedParameter(restored, 'semanticDelay', DEFAULT_PIXEL_FLOW_SEMANTIC_DELAY))
    setBloomStrength(savedParameter(restored, 'bloomStrength', DEFAULT_PIXEL_FLOW_BLOOM))
    setFilterStrength(savedParameter(restored, 'filterStrength', DEFAULT_PIXEL_FLOW_FILTER))
    setColorTransition(savedParameter(restored, 'colorTransition', DEFAULT_PIXEL_FLOW_COLOR_TRANSITION))
    const restoredCurrent = restored?.settingsVersion === PIXEL_FLOW_SETTINGS_VERSION
    setFlowMode(restoredCurrent ? restored.flowMode ?? DEFAULT_PIXEL_FLOW_MODE : DEFAULT_PIXEL_FLOW_MODE)
    setTrajectory(restoredCurrent ? restored.trajectory ?? DEFAULT_PIXEL_FLOW_TRAJECTORY : DEFAULT_PIXEL_FLOW_TRAJECTORY)
    setSkyMode(restored?.skyMode ?? DEFAULT_PIXEL_FLOW_SKY_MODE)
    setOtherDirection(restored?.otherDirection ?? DEFAULT_PIXEL_FLOW_OTHER_DIRECTION)
    setMaskPath(restored?.maskPath ?? null)
    setSkyMaskPath(restored?.skyMaskPath ?? null)
    setDepthMaskPath(restored?.depthMaskPath ?? null)
    setSubjectMask(null)
    setSkyMask(null)
    setSkyBlackRatio(0)
    setSourceSize(null)
    setCurrentTime(0)
    setPlaying(false)
    setSegmenting(false)
    setProgress('')
    setGpuFallback(false)
    setSeekRevision((revision) => revision + 1)
    depthBuildRef.current = null
    attemptedAssetRef.current = null
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
    if (flowMode !== 'segmented' || !projectId || !activeAssetId || !subjectMask || !skyMask || depthMaskPath) return
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
    }).catch((error) => {
      if (depthBuildRef.current === buildKey) {
        depthBuildRef.current = null
        toast.error(error instanceof Error ? error.message : '无法准备画面层次')
      }
    })
  }, [activeAssetId, depthMaskPath, flowMode, maskPath, projectId, skyMask, skyMaskPath, subjectMask])

  useEffect(() => {
    if (!activeAsset || activeAsset.kind !== 'image') return
    let cancelled = false
    window.luna.workspace.getMediaResolution(activeAsset.path).then((size) => {
      if (cancelled) return
      setSourceSize(size)
    }).catch(() => { if (!cancelled) toast.error('无法读取图片尺寸') })
    return () => { cancelled = true }
  }, [activeAsset])

  useEffect(() => {
    if (flowMode !== 'segmented' || !activeAsset || !skyMask) return
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    void window.luna.workspace.loadPreview(activeAsset.path).then(async (preview) => {
      bitmap = await createImageBitmap(new Blob([preview.buffer], { type: preview.mimeType }))
      if (cancelled) {
        bitmap.close()
        return
      }
      const canvas = new OffscreenCanvas(skyMask.width, skyMask.height)
      const context = canvas.getContext('2d')
      if (!context) return
      context.drawImage(bitmap, 0, 0, skyMask.width, skyMask.height)
      const pixels = context.getImageData(0, 0, skyMask.width, skyMask.height).data
      if (!cancelled) setSkyBlackRatio(pixelFlowSkyBlackRatio(pixels, skyMask))
    }).catch(() => { if (!cancelled) setSkyBlackRatio(0) })
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [activeAsset, flowMode, skyMask])

  useEffect(() => {
    const ready = flowMode === 'whole-frame' || Boolean(depthMaskPath && skyMask)
    if (!ready || !sourceSize) return
    setCurrentTime(0)
    setPlaying(true)
    setSeekRevision((revision) => revision + 1)
  }, [depthMaskPath, flowMode, skyMask, sourceSize])

  useEffect(() => {
    if (flowMode !== 'whole-frame' || !operationRef.current) return
    operationRef.current = null
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
    setSegmenting(false)
    setProgress('')
  }, [flowMode])

  const segmentScene = useCallback(async () => {
    if (!activeAsset || !media.currentProject || activeAsset.kind !== 'image' || segmenting) return
    const operationId = crypto.randomUUID()
    operationRef.current = operationId
    setDepthMaskPath(null)
    setSubjectMask(null)
    setSkyMask(null)
    depthBuildRef.current = null
    setSegmenting(true)
    setProgress('正在识别画面层次')
    const unsubscribe = window.luna.onWorkspaceSegmentationProgress((event) => {
      if (requestRef.current.has(event.requestId)) setProgress(event.label)
    })
    const subjectRequestId = `${operationId}-subject`
    const skyRequestId = `${operationId}-sky`
    try {
      requestRef.current.add(subjectRequestId)
      setProgress('正在识别画面主体')
      const subjectResult = await window.luna.workspace.segmentImage({
        requestId: subjectRequestId,
        filePath: activeAsset.path,
        targetId: 'subject',
      })
      requestRef.current.delete(subjectRequestId)
      if (operationRef.current !== operationId) return
      const subjectData = new Uint8Array(subjectResult.bytes)
      const savedSubjectMask = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        activeAsset.id,
        subjectResult.width,
        subjectResult.height,
        subjectData,
        1,
      )
      if (operationRef.current !== operationId) return
      setSubjectMask({ data: subjectData, width: subjectResult.width, height: subjectResult.height })
      setMaskPath(savedSubjectMask.path)

      requestRef.current.add(skyRequestId)
      setProgress('正在识别天空层次')
      const skyResult = await window.luna.workspace.segmentImage({
        requestId: skyRequestId,
        filePath: activeAsset.path,
        targetId: 'sky',
      })
      requestRef.current.delete(skyRequestId)
      if (operationRef.current !== operationId) return
      const skyData = new Uint8Array(skyResult.bytes)
      const savedSkyMask = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        activeAsset.id,
        skyResult.width,
        skyResult.height,
        skyData,
        1,
      )
      if (operationRef.current !== operationId) return
      setSkyMask({ data: skyData, width: skyResult.width, height: skyResult.height })
      setSkyMaskPath(savedSkyMask.path)
      setCurrentTime(0)
      setPlaying(true)
    } catch (error) {
      if (operationRef.current === operationId) {
        toast.error(error instanceof Error ? error.message : '画面识别失败')
      }
    } finally {
      unsubscribe()
      requestRef.current.delete(subjectRequestId)
      requestRef.current.delete(skyRequestId)
      if (operationRef.current === operationId) {
        operationRef.current = null
        setSegmenting(false)
        setProgress('')
      }
    }
  }, [activeAsset, media.currentProject, segmenting])

  useEffect(() => {
    if (flowMode !== 'segmented' || !isImage || !activeAsset || (maskPath && skyMaskPath) || segmenting) return
    if (attemptedAssetRef.current === activeAsset.id) return
    attemptedAssetRef.current = activeAsset.id
    void segmentScene()
  }, [activeAsset, flowMode, isImage, maskPath, segmentScene, segmenting, skyMaskPath])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId) return
    const state: WorkspacePixelFlowState = {
      settingsVersion: PIXEL_FLOW_SETTINGS_VERSION,
      flowMode,
      trajectory,
      skyMode,
      otherDirection,
      duration,
      pixelCount,
      lightWidth,
      semanticDelay,
      bloomStrength,
      filterStrength,
      colorTransition,
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
  }, [activeAssetId, bloomStrength, colorTransition, depthMaskPath, duration, filterStrength, flowMode, lightWidth, maskPath, otherDirection, pixelCount, semanticDelay, skyMaskPath, skyMode, trajectory])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
  }, [])

  const handleError = useCallback((message: string) => toast.error(message), [])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - previous) / 1000
      previous = now
      setCurrentTime((time) => {
        const next = Math.min(duration, time + elapsed)
        if (next >= duration) setPlaying(false)
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [duration, playing])

  const regionScales = useMemo(() => subjectMask && skyMask
    ? pixelFlowRegionScales(subjectMask, skyMask)
    : { sky: 1, background: 1, subject: 1 }, [skyMask, subjectMask])
  const previewLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    if (flowMode === 'segmented' && (!depthMaskPath || !skyMask)) return []
    const origin = flowMode === 'whole-frame' ? { x: 0.5, y: 0.06 } : pixelFlowOrigin(skyMask)
    const impact = flowMode === 'whole-frame' ? { x: 0.5, y: 0.14 } : pixelFlowImpact(skyMask, origin)
    return [{
      layerType: 'pixel-flow',
      filePath: activeAsset.path,
      isVideo: false,
      fit: 'stretch',
      dstX: 0,
      dstY: 0,
      dstW: 1,
      dstH: 1,
      srcX: 0,
      srcY: 0,
      srcW: 1,
      srcH: 1,
      opacity: 1,
      zIndex: 0,
      maskPath: flowMode === 'segmented' ? depthMaskPath ?? undefined : undefined,
      pixelFlow: {
        duration,
        flowMode,
        trajectory,
        skyMode,
        otherDirection,
        pixelCount,
        lightWidth,
        depthStrength: Math.min(100, semanticDelay * 4),
        originX: origin.x,
        originY: origin.y,
        impactX: impact.x,
        impactY: impact.y,
        skyScale: regionScales.sky,
        backgroundScale: regionScales.background,
        subjectScale: regionScales.subject,
        skyBlackRatio,
        bloomStrength,
        filterStrength,
        colorTransition,
      },
    }]
  }, [activeAsset, bloomStrength, colorTransition, depthMaskPath, duration, filterStrength, flowMode, lightWidth, otherDirection, pixelCount, regionScales, semanticDelay, skyBlackRatio, skyMask, skyMode, sourceSize, trajectory])
  const gpuPreviewSize = useMemo(() => {
    if (!sourceSize) return null
    const scale = Math.min(1, 1080 / Math.max(sourceSize.width, sourceSize.height))
    return {
      width: Math.max(1, Math.round(sourceSize.width * scale)),
      height: Math.max(1, Math.round(sourceSize.height * scale)),
    }
  }, [sourceSize])

  function replay(): void {
    setCurrentTime(0)
    setPlaying(true)
    setSeekRevision((revision) => revision + 1)
  }

  function seek(time: number): void {
    setPlaying(false)
    setCurrentTime(time)
    setSeekRevision((revision) => revision + 1)
  }

  function resetParameters(): void {
    setDuration(DEFAULT_PIXEL_FLOW_DURATION)
    setPixelCount(DEFAULT_PIXEL_FLOW_COUNT)
    setLightWidth(DEFAULT_PIXEL_FLOW_WIDTH)
    setSemanticDelay(DEFAULT_PIXEL_FLOW_SEMANTIC_DELAY)
    setBloomStrength(DEFAULT_PIXEL_FLOW_BLOOM)
    setFilterStrength(DEFAULT_PIXEL_FLOW_FILTER)
    setColorTransition(DEFAULT_PIXEL_FLOW_COLOR_TRANSITION)
    setFlowMode(DEFAULT_PIXEL_FLOW_MODE)
    setTrajectory(DEFAULT_PIXEL_FLOW_TRAJECTORY)
    setSkyMode(DEFAULT_PIXEL_FLOW_SKY_MODE)
    setOtherDirection(DEFAULT_PIXEL_FLOW_OTHER_DIRECTION)
    replay()
  }

  return <section className="pixel-flow-page">
    <header className="pixel-flow-toolbar">
      <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button>
      <span>像素流光</span>
      <Button className="pixel-flow-replay" variant="toolbar" size="compact" icon={<Play size={14} />} disabled={!sourceSize} onClick={replay}>重播</Button>
    </header>
    <div className="pixel-flow-preview">
      {activeAsset && !isImage ? <div className="pixel-flow-empty"><ScanLine size={28} /><strong>请选择图片素材</strong><span>像素流光目前支持图片素材</span></div>
        : activeAsset ? <div className={`pixel-flow-stage${sourceSize ? sourceSize.width > sourceSize.height ? ' is-landscape' : ' is-portrait' : ''}`}>
          <div className="pixel-flow-render-surface">
            {previewLayers.length > 0 && gpuPreviewSize && (gpuFallback
              ? <LrcRender className="pixel-flow-canvas" layers={previewLayers} canvasWidth={gpuPreviewSize.width} canvasHeight={gpuPreviewSize.height} maxSide={1080} compositionTime={currentTime} interactiveImageLayerIndexes={[]} onError={handleError} />
              : <NativeGpuVideoPreview className="pixel-flow-canvas" layers={previewLayers} canvasWidth={gpuPreviewSize.width} canvasHeight={gpuPreviewSize.height} playing={playing} time={currentTime} seekRevision={seekRevision} onFallback={() => setGpuFallback(true)} />)}
          </div>
          {segmenting && <div className="pixel-flow-identifying" role="status"><LoadingIndicator /><span>{progress || '正在识别画面层次'}</span></div>}
          <VideoControls className="pixel-flow-controls" currentTime={currentTime} duration={duration} playing={playing} onToggle={() => playing ? setPlaying(false) : replay()} onSeek={seek} step={0.01} />
        </div>
          : <div className="pixel-flow-empty"><ScanLine size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要制作效果的图片</span></div>}
    </div>
    <aside className="pixel-flow-panel">
      <div className="pixel-flow-panel-head"><strong>效果设置</strong><span>{flowMode === 'whole-frame' ? '从画面上方向下坠落，并由内向外展开' : '天空先向外点亮，再逐层落向背景和主体'}</span></div>
      <div className="pixel-flow-options">
        <div className="pixel-flow-preset-field"><span>流动方式</span><Select variant="compact" fullWidth placeholder="流动方式" options={PIXEL_FLOW_MODE_OPTIONS} value={flowMode} onValueChange={(value) => setFlowMode(value as PixelFlowMode)} /></div>
        {flowMode === 'whole-frame' && <div className="pixel-flow-preset-field"><span>流动预设</span><Select variant="compact" fullWidth placeholder="流动预设" options={PIXEL_FLOW_TRAJECTORY_OPTIONS} value={trajectory} onValueChange={(value) => setTrajectory(value as PixelFlowTrajectory)} /></div>}
        {flowMode === 'segmented' && <>
          <div className="pixel-flow-preset-field"><span>天空效果</span><Select variant="compact" fullWidth placeholder="天空效果" options={PIXEL_FLOW_SKY_MODE_OPTIONS} value={skyMode} onValueChange={(value) => setSkyMode(value as PixelFlowSkyMode)} /></div>
          <div className="pixel-flow-preset-field"><span>其他方向</span><Select variant="compact" fullWidth placeholder="其他方向" options={PIXEL_FLOW_OTHER_DIRECTION_OPTIONS} value={otherDirection} onValueChange={(value) => setOtherDirection(value as PixelFlowOtherDirection)} /></div>
        </>}
        <ParamSlider label="流动时间" value={duration} min={1.5} max={6} step={0.1} onChange={setDuration} formatValue={(value) => `${value.toFixed(1)}s`} />
        <ParamSlider label="像素块数量" value={pixelCount} min={40} max={320} step={4} onChange={setPixelCount} formatValue={(value) => `${Math.round(value)}个`} />
        <ParamSlider label="波纹宽度比例" value={lightWidth} min={2} max={30} onChange={setLightWidth} formatValue={(value) => `${value}%`} />
        <ParamSlider label="CCD 泛光" value={bloomStrength} min={0} max={100} onChange={setBloomStrength} />
        <ParamSlider label="赫兹色彩" value={filterStrength} min={0} max={100} onChange={setFilterStrength} />
        <ParamSlider label="色彩过渡" value={colorTransition} min={0} max={1} step={0.05} onChange={setColorTransition} formatValue={(value) => `${value.toFixed(2)}s`} />
        {flowMode === 'segmented' && <ParamSlider label="层次速度差" value={semanticDelay} min={0} max={24} onChange={setSemanticDelay} />}
        {flowMode === 'segmented' && subjectMask && skyMask && <span className="pixel-flow-ready">已按天空和主体调整流动速度</span>}
      </div>
      <div className="pixel-flow-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={resetParameters} /><Button variant="primary" size="compact" icon={<Play size={14} />} disabled={!sourceSize} onClick={replay}>播放效果</Button></div>
    </aside>
    <div className="pixel-flow-media-strip"><WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} /></div>
  </section>
}
