import { ArrowLeft, Play, RotateCcw, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkspacePixelFlowState, WorkspaceProject } from '../../../shared/types'
import { Button, IconButton, LoadingIndicator, VideoControls, toast } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import type { CreativeModuleProps } from '../creativeCatalog'
import { PixelFlowCanvas } from './PixelFlowCanvas'
import type { PixelFlowMask } from './pixelFlowRender'
import './pixel-flow.css'

const DEFAULT_DURATION = 3.2
const DEFAULT_PIXEL_SIZE = 12
const DEFAULT_LIGHT_WIDTH = 7
const DEFAULT_SEMANTIC_DELAY = 11

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
  const [duration, setDuration] = useState(saved?.duration ?? DEFAULT_DURATION)
  const [pixelSize, setPixelSize] = useState(saved?.pixelSize ?? DEFAULT_PIXEL_SIZE)
  const [lightWidth, setLightWidth] = useState(saved?.lightWidth ?? DEFAULT_LIGHT_WIDTH)
  const [semanticDelay, setSemanticDelay] = useState(saved?.semanticDelay ?? DEFAULT_SEMANTIC_DELAY)
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskPath ?? null)
  const [skyMaskPath, setSkyMaskPath] = useState<string | null>(saved?.skyMaskPath ?? null)
  const [subjectMask, setSubjectMask] = useState<PixelFlowMask | null>(null)
  const [skyMask, setSkyMask] = useState<PixelFlowMask | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const requestRef = useRef(new Set<string>())
  const operationRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const isImage = activeAsset?.kind === 'image'

  useEffect(() => {
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
    operationRef.current = null
    const restored = stateForAsset(media.currentProject, activeAssetId)
    setDuration(restored?.duration ?? DEFAULT_DURATION)
    setPixelSize(restored?.pixelSize ?? DEFAULT_PIXEL_SIZE)
    setLightWidth(restored?.lightWidth ?? DEFAULT_LIGHT_WIDTH)
    setSemanticDelay(restored?.semanticDelay ?? DEFAULT_SEMANTIC_DELAY)
    setMaskPath(restored?.maskPath ?? null)
    setSkyMaskPath(restored?.skyMaskPath ?? null)
    setSubjectMask(null)
    setSkyMask(null)
    setSourceSize(null)
    setCurrentTime(0)
    setPlaying(false)
    setSegmenting(false)
    setProgress('')
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
    setCurrentTime(0)
    setPlaying(true)
    return () => { cancelled = true }
  }, [maskPath, projectId, skyMaskPath])

  const segmentScene = useCallback(async () => {
    if (!activeAsset || !media.currentProject || activeAsset.kind !== 'image' || segmenting) return
    const operationId = crypto.randomUUID()
    operationRef.current = operationId
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
    if (!isImage || !activeAsset || (maskPath && skyMaskPath) || segmenting) return
    if (attemptedAssetRef.current === activeAsset.id) return
    attemptedAssetRef.current = activeAsset.id
    void segmentScene()
  }, [activeAsset, isImage, maskPath, segmentScene, segmenting, skyMaskPath])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId) return
    const state: WorkspacePixelFlowState = {
      duration,
      pixelSize,
      lightWidth,
      semanticDelay,
      maskPath: maskPath ?? undefined,
      skyMaskPath: skyMaskPath ?? undefined,
      maskAssetId: maskPath || skyMaskPath ? activeAssetId : undefined,
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
  }, [activeAssetId, duration, lightWidth, maskPath, pixelSize, semanticDelay, skyMaskPath])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    for (const requestId of requestRef.current) void window.luna.workspace.cancelSegmentation(requestId)
    requestRef.current.clear()
  }, [])

  const handleReady = useCallback((size: { width: number; height: number }) => {
    setSourceSize(size)
    setCurrentTime(0)
    setPlaying(true)
  }, [])
  const handleError = useCallback((message: string) => toast.error(message), [])

  function replay(): void {
    setCurrentTime(0)
    setPlaying(true)
  }

  function resetParameters(): void {
    setDuration(DEFAULT_DURATION)
    setPixelSize(DEFAULT_PIXEL_SIZE)
    setLightWidth(DEFAULT_LIGHT_WIDTH)
    setSemanticDelay(DEFAULT_SEMANTIC_DELAY)
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
        : activeAsset ? <div className={`pixel-flow-stage ui-video-controls-host${sourceSize ? sourceSize.width > sourceSize.height ? ' is-landscape' : ' is-portrait' : ''}`} style={sourceSize ? { aspectRatio: `${sourceSize.width} / ${sourceSize.height}` } : undefined}>
          <PixelFlowCanvas asset={activeAsset} subjectMask={subjectMask} skyMask={skyMask} duration={duration} pixelSize={pixelSize} lightWidth={lightWidth} semanticDelay={semanticDelay} playing={playing} currentTime={currentTime} onTimeChange={setCurrentTime} onEnded={() => setPlaying(false)} onReady={handleReady} onError={handleError} />
          {segmenting && <div className="pixel-flow-identifying" role="status"><LoadingIndicator /><span>{progress || '正在识别画面层次'}</span></div>}
          <VideoControls currentTime={currentTime} duration={duration} playing={playing} onToggle={() => playing ? setPlaying(false) : replay()} onSeek={(time) => { setPlaying(false); setCurrentTime(time) }} step={0.01} />
        </div>
          : <div className="pixel-flow-empty"><ScanLine size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要制作效果的图片</span></div>}
    </div>
    <aside className="pixel-flow-panel">
      <div className="pixel-flow-panel-head"><strong>效果设置</strong><span>流光从天空下坠，在落点向四周扩散</span></div>
      <div className="pixel-flow-options">
        <ParamSlider label="流动时间" value={duration} min={1.5} max={6} step={0.1} onChange={setDuration} formatValue={(value) => `${value.toFixed(1)}s`} />
        <ParamSlider label="流光方块大小" value={pixelSize} min={4} max={36} onChange={setPixelSize} formatValue={(value) => `${value}px`} />
        <ParamSlider label="波纹宽度" value={lightWidth} min={2} max={16} onChange={setLightWidth} />
        <ParamSlider label="层次速度差" value={semanticDelay} min={0} max={24} onChange={setSemanticDelay} />
        {subjectMask && skyMask && <span className="pixel-flow-ready">已按天空和主体调整流动速度</span>}
      </div>
      <div className="pixel-flow-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={resetParameters} /><Button variant="primary" size="compact" icon={<Play size={14} />} disabled={!sourceSize} onClick={replay}>播放效果</Button></div>
    </aside>
    <div className="pixel-flow-media-strip"><WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} /></div>
  </section>
}
