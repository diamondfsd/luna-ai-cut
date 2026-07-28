import { ArrowLeft, Play, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LrcRender } from '../../../components/LrcRender'
import { NativeGpuVideoPreview } from '../../../components/NativeGpuVideoPreview'
import type { PreviewLayer, WorkspacePixelFlowState, WorkspaceProject } from '../../../shared/types'
import { Button, LoadingIndicator, VideoControls, toast } from '../../../ui'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import type { CreativeModuleProps } from '../creativeCatalog'
import { PixelFlowControls } from './PixelFlowControls'
import { combinePixelFlowDepthMask, type PixelFlowMask } from './pixelFlowRender'
import {
  DEFAULT_PIXEL_FLOW_BLOOM,
  DEFAULT_PIXEL_FLOW_COLOR_TRANSITION,
  DEFAULT_PIXEL_FLOW_COUNT,
  DEFAULT_PIXEL_FLOW_DURATION,
  DEFAULT_PIXEL_FLOW_FILTER,
  DEFAULT_PIXEL_FLOW_FLOW_STRENGTH,
  DEFAULT_PIXEL_FLOW_RAIN_LENGTH,
  DEFAULT_PIXEL_FLOW_RAIN_SPEED,
  DEFAULT_PIXEL_FLOW_SUBJECT_DELAY,
  DEFAULT_PIXEL_FLOW_WIDTH,
  PIXEL_FLOW_SETTINGS_VERSION,
} from './pixelFlowPresets'
import './pixel-flow.css'

type NumericPixelFlowKey = 'duration' | 'pixelCount' | 'lightWidth' | 'rainSpeed' | 'rainLength'
  | 'flowStrength' | 'subjectDelay' | 'bloomStrength' | 'filterStrength' | 'colorTransition'

function savedParameter(
  saved: WorkspacePixelFlowState | undefined,
  key: NumericPixelFlowKey,
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
  const [bloomStrength, setBloomStrength] = useState(savedParameter(saved, 'bloomStrength', DEFAULT_PIXEL_FLOW_BLOOM))
  const [filterStrength, setFilterStrength] = useState(savedParameter(saved, 'filterStrength', DEFAULT_PIXEL_FLOW_FILTER))
  const [colorTransition, setColorTransition] = useState(savedParameter(saved, 'colorTransition', DEFAULT_PIXEL_FLOW_COLOR_TRANSITION))
  const [rainSpeed, setRainSpeed] = useState(savedParameter(saved, 'rainSpeed', DEFAULT_PIXEL_FLOW_RAIN_SPEED))
  const [rainLength, setRainLength] = useState(savedParameter(saved, 'rainLength', DEFAULT_PIXEL_FLOW_RAIN_LENGTH))
  const [flowStrength, setFlowStrength] = useState(savedParameter(saved, 'flowStrength', DEFAULT_PIXEL_FLOW_FLOW_STRENGTH))
  const [subjectDelay, setSubjectDelay] = useState(savedParameter(saved, 'subjectDelay', DEFAULT_PIXEL_FLOW_SUBJECT_DELAY))
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskPath ?? null)
  const [skyMaskPath, setSkyMaskPath] = useState<string | null>(saved?.skyMaskPath ?? null)
  const [depthMaskPath, setDepthMaskPath] = useState<string | null>(saved?.depthMaskPath ?? null)
  const [subjectMask, setSubjectMask] = useState<PixelFlowMask | null>(null)
  const [skyMask, setSkyMask] = useState<PixelFlowMask | null>(null)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [gpuFallback, setGpuFallback] = useState(false)
  const [seekRevision, setSeekRevision] = useState(0)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const requestRef = useRef(new Set<string>())
  const operationRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)
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
    setBloomStrength(savedParameter(restored, 'bloomStrength', DEFAULT_PIXEL_FLOW_BLOOM))
    setFilterStrength(savedParameter(restored, 'filterStrength', DEFAULT_PIXEL_FLOW_FILTER))
    setColorTransition(savedParameter(restored, 'colorTransition', DEFAULT_PIXEL_FLOW_COLOR_TRANSITION))
    setRainSpeed(savedParameter(restored, 'rainSpeed', DEFAULT_PIXEL_FLOW_RAIN_SPEED))
    setRainLength(savedParameter(restored, 'rainLength', DEFAULT_PIXEL_FLOW_RAIN_LENGTH))
    setFlowStrength(savedParameter(restored, 'flowStrength', DEFAULT_PIXEL_FLOW_FLOW_STRENGTH))
    setSubjectDelay(savedParameter(restored, 'subjectDelay', DEFAULT_PIXEL_FLOW_SUBJECT_DELAY))
    setMaskPath(restored?.maskPath ?? null)
    setSkyMaskPath(restored?.skyMaskPath ?? null)
    setDepthMaskPath(restored?.depthMaskPath ?? null)
    setSubjectMask(null)
    setSkyMask(null)
    setSegmenting(false)
    setProgress('')
    setSourceSize(null)
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
    window.luna.workspace.getMediaResolution(activeAsset.path).then((size) => {
      if (cancelled) return
      setSourceSize(size)
      setCurrentTime(0)
      setPlaying(true)
      setSeekRevision((revision) => revision + 1)
    }).catch(() => { if (!cancelled) toast.error('无法读取素材尺寸') })
    return () => { cancelled = true }
  }, [activeAsset])

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
      const savedSky = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        `${activeAsset.id}-pixel-flow-sky`,
        skyResult.width,
        skyResult.height,
        skyData,
        1,
      )
      if (operationRef.current !== operationId) return
      setSkyMask({ data: skyData, width: skyResult.width, height: skyResult.height })
      setSkyMaskPath(savedSky.path)
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
    if (!isImage || !activeAsset || (maskPath && skyMaskPath) || segmenting) return
    if (attemptedAssetRef.current === activeAsset.id) return
    attemptedAssetRef.current = activeAsset.id
    void segmentScene()
  }, [activeAsset, isImage, maskPath, segmentScene, segmenting, skyMaskPath])

  useEffect(() => {
    if (!depthMaskPath) return
    setCurrentTime(0)
    setPlaying(true)
    setSeekRevision((revision) => revision + 1)
  }, [depthMaskPath])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId) return
    const state: WorkspacePixelFlowState = {
      settingsVersion: PIXEL_FLOW_SETTINGS_VERSION,
      duration,
      pixelCount,
      lightWidth,
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
  }, [activeAssetId, bloomStrength, colorTransition, depthMaskPath, duration, filterStrength, flowStrength, lightWidth, maskPath, pixelCount, rainLength, rainSpeed, skyMaskPath, subjectDelay])

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
        const next = Math.min(duration, time + elapsed)
        if (next >= duration) setPlaying(false)
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [duration, playing])

  const previewLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return [{
      layerType: 'pixel-flow',
      filePath: activeAsset.path,
      isVideo: activeAsset.kind === 'video',
      videoTime: 0,
      videoDuration: activeAsset.kind === 'video' ? duration : undefined,
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
      maskPath: depthMaskPath ?? undefined,
      pixelFlow: {
        duration,
        pixelCount,
        lightWidth,
        rainSpeed,
        rainLength,
        flowStrength,
        subjectDelay,
        bloomStrength,
        filterStrength,
        colorTransition,
        segmented: Boolean(depthMaskPath),
      },
    }]
  }, [activeAsset, bloomStrength, colorTransition, depthMaskPath, duration, filterStrength, flowStrength, lightWidth, pixelCount, rainLength, rainSpeed, sourceSize, subjectDelay])
  const gpuPreviewSize = useMemo(() => {
    if (!sourceSize) return null
    const scale = Math.min(1, 1080 / Math.max(sourceSize.width, sourceSize.height))
    return {
      width: Math.max(1, Math.round(sourceSize.width * scale)),
      height: Math.max(1, Math.round(sourceSize.height * scale)),
    }
  }, [sourceSize])

  const replay = useCallback(() => {
    setCurrentTime(0)
    setPlaying(true)
    setSeekRevision((revision) => revision + 1)
  }, [])

  function seek(time: number): void {
    setPlaying(false)
    setCurrentTime(time)
    setSeekRevision((revision) => revision + 1)
  }

  function resetParameters(): void {
    setDuration(DEFAULT_PIXEL_FLOW_DURATION)
    setPixelCount(DEFAULT_PIXEL_FLOW_COUNT)
    setLightWidth(DEFAULT_PIXEL_FLOW_WIDTH)
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

  return <section className="pixel-flow-page">
    <header className="pixel-flow-toolbar">
      <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button>
      <span>像素流光</span>
      <Button className="pixel-flow-replay" variant="toolbar" size="compact" icon={<Play size={14} />} disabled={!sourceSize} onClick={replay}>重播</Button>
    </header>
    <div className="pixel-flow-preview">
      {activeAsset ? <div className={`pixel-flow-stage${sourceSize ? sourceSize.width > sourceSize.height ? ' is-landscape' : ' is-portrait' : ''}`}>
        <div className="pixel-flow-render-surface">
          {previewLayers.length > 0 && gpuPreviewSize && (gpuFallback
            ? <LrcRender className="pixel-flow-canvas" layers={previewLayers} canvasWidth={gpuPreviewSize.width} canvasHeight={gpuPreviewSize.height} maxSide={1080} compositionTime={currentTime} interactiveImageLayerIndexes={[]} onError={handleError} />
            : <NativeGpuVideoPreview className="pixel-flow-canvas" layers={previewLayers} canvasWidth={gpuPreviewSize.width} canvasHeight={gpuPreviewSize.height} playing={playing} time={currentTime} seekRevision={seekRevision} onFallback={() => setGpuFallback(true)} />)}
        </div>
        {segmenting && <div className="pixel-flow-identifying" role="status"><LoadingIndicator /><span>{progress || '正在识别画面层次'}</span></div>}
        <VideoControls className="pixel-flow-controls" currentTime={currentTime} duration={duration} playing={playing} onToggle={() => playing ? setPlaying(false) : replay()} onSeek={seek} step={1 / 60} />
      </div>
        : <div className="pixel-flow-empty"><ScanLine size={28} /><strong>选择图片或视频素材</strong><span>在下方素材栏中选择需要制作效果的素材</span></div>}
    </div>
    <PixelFlowControls
      duration={duration} pixelCount={pixelCount} lightWidth={lightWidth} bloomStrength={bloomStrength}
      filterStrength={filterStrength} colorTransition={colorTransition} rainSpeed={rainSpeed} rainLength={rainLength}
      flowStrength={flowStrength} subjectDelay={subjectDelay} disabled={!sourceSize}
      onDurationChange={setDuration} onPixelCountChange={setPixelCount} onLightWidthChange={setLightWidth}
      onBloomStrengthChange={setBloomStrength} onFilterStrengthChange={setFilterStrength}
      onColorTransitionChange={setColorTransition} onRainSpeedChange={setRainSpeed} onRainLengthChange={setRainLength}
      onFlowStrengthChange={setFlowStrength} onSubjectDelayChange={setSubjectDelay} onReset={resetParameters} onReplay={replay}
    />
    <div className="pixel-flow-media-strip"><WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} /></div>
  </section>
}
