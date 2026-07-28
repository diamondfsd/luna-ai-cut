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
  const [mask, setMask] = useState<PixelFlowMask | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const requestRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const isImage = activeAsset?.kind === 'image'

  useEffect(() => {
    if (requestRef.current) {
      void window.luna.workspace.cancelSegmentation(requestRef.current)
      requestRef.current = null
    }
    const restored = stateForAsset(media.currentProject, activeAssetId)
    setDuration(restored?.duration ?? DEFAULT_DURATION)
    setPixelSize(restored?.pixelSize ?? DEFAULT_PIXEL_SIZE)
    setLightWidth(restored?.lightWidth ?? DEFAULT_LIGHT_WIDTH)
    setSemanticDelay(restored?.semanticDelay ?? DEFAULT_SEMANTIC_DELAY)
    setMaskPath(restored?.maskPath ?? null)
    setMask(null)
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
    if (!maskPath || !projectId) {
      setMask(null)
      return
    }
    let cancelled = false
    window.luna.workspace.loadColorMask(projectId, maskPath).then((loaded) => {
      if (!cancelled) {
        setMask({ data: new Uint8Array(loaded.bytes), width: loaded.width, height: loaded.height })
        setCurrentTime(0)
        setPlaying(true)
      }
    }).catch(() => {
      if (!cancelled) setMaskPath(null)
    })
    return () => { cancelled = true }
  }, [maskPath, projectId])

  const segmentScene = useCallback(async () => {
    if (!activeAsset || !media.currentProject || activeAsset.kind !== 'image' || segmenting) return
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setSegmenting(true)
    setProgress('正在识别画面层次')
    const unsubscribe = window.luna.onWorkspaceSegmentationProgress((event) => {
      if (event.requestId === requestId) setProgress(event.label)
    })
    try {
      const result = await window.luna.workspace.segmentImage({
        requestId,
        filePath: activeAsset.path,
        modelId: 'rmbg-1.4',
      })
      if (requestRef.current !== requestId) return
      const data = new Uint8Array(result.bytes)
      const savedMask = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        activeAsset.id,
        result.width,
        result.height,
        data,
        1,
      )
      if (requestRef.current !== requestId) return
      setMask({ data, width: result.width, height: result.height })
      setMaskPath(savedMask.path)
      setCurrentTime(0)
      setPlaying(true)
    } catch (error) {
      if (requestRef.current === requestId) {
        toast.error(error instanceof Error ? error.message : '画面识别失败')
      }
    } finally {
      unsubscribe()
      if (requestRef.current === requestId) {
        requestRef.current = null
        setSegmenting(false)
        setProgress('')
      }
    }
  }, [activeAsset, media.currentProject, segmenting])

  useEffect(() => {
    if (!isImage || !activeAsset || maskPath || segmenting) return
    if (attemptedAssetRef.current === activeAsset.id) return
    attemptedAssetRef.current = activeAsset.id
    void segmentScene()
  }, [activeAsset, isImage, maskPath, segmentScene, segmenting])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId) return
    const state: WorkspacePixelFlowState = {
      duration,
      pixelSize,
      lightWidth,
      semanticDelay,
      maskPath: maskPath ?? undefined,
      maskAssetId: maskPath ? activeAssetId : undefined,
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
  }, [activeAssetId, duration, lightWidth, maskPath, pixelSize, semanticDelay])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    if (requestRef.current) void window.luna.workspace.cancelSegmentation(requestRef.current)
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
          <PixelFlowCanvas asset={activeAsset} mask={mask} duration={duration} pixelSize={pixelSize} lightWidth={lightWidth} semanticDelay={semanticDelay} playing={playing} currentTime={currentTime} onTimeChange={setCurrentTime} onEnded={() => setPlaying(false)} onReady={handleReady} onError={handleError} />
          {segmenting && <div className="pixel-flow-identifying" role="status"><LoadingIndicator /><span>{progress || '正在识别画面层次'}</span></div>}
          <VideoControls currentTime={currentTime} duration={duration} playing={playing} onToggle={() => playing ? setPlaying(false) : replay()} onSeek={(time) => { setPlaying(false); setCurrentTime(time) }} step={0.01} />
        </div>
          : <div className="pixel-flow-empty"><ScanLine size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要制作效果的图片</span></div>}
    </div>
    <aside className="pixel-flow-panel">
      <div className="pixel-flow-panel-head"><strong>效果设置</strong><span>流光沿画面内容从上向下唤醒色彩</span></div>
      <div className="pixel-flow-options">
        <ParamSlider label="流动时间" value={duration} min={1.5} max={6} step={0.1} onChange={setDuration} formatValue={(value) => `${value.toFixed(1)}s`} />
        <ParamSlider label="像素大小" value={pixelSize} min={5} max={28} onChange={setPixelSize} />
        <ParamSlider label="光带宽度" value={lightWidth} min={2} max={16} onChange={setLightWidth} />
        <ParamSlider label="内容速度差" value={semanticDelay} min={0} max={24} onChange={setSemanticDelay} />
        {mask && <span className="pixel-flow-ready">已按画面主体调整流动速度</span>}
      </div>
      <div className="pixel-flow-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={resetParameters} /><Button variant="primary" size="compact" icon={<Play size={14} />} disabled={!sourceSize} onClick={replay}>播放效果</Button></div>
    </aside>
    <div className="pixel-flow-media-strip"><WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} /></div>
  </section>
}
