import { ArrowLeft, Download, RotateCcw, WandSparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { WebGpuMultiLayerVideoPreview } from '../../../components/WebGpuMultiLayerVideoPreview'
import type { MediaMetadata, PreviewLayer, VideoExportSettings } from '../../../shared/types'
import { Button, IconButton, SegmentedControl, VideoControls, toast } from '../../../ui'
import { useLunaUltraWatermark } from '../../../hooks/useLunaUltraWatermark'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { WorkspaceMediaImportButtons } from '../../components/WorkspaceMediaImportButtons'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { loadCreativeImageSize, normalizeCreativePipeline } from '../shared/creativeMedia'
import {
  colorRevealCreativeDuration,
  colorRevealTransitionMax,
  DEFAULT_GRAY,
  DEFAULT_INITIAL_HOLD_DURATION,
  DEFAULT_MIDPOINT_HOLD_DURATION,
  DEFAULT_SATURATION,
  DEFAULT_STAGE_MODE,
  DEFAULT_TRANSITION_DURATION,
  IMAGE_CREATIVE_DURATION,
  savedGray,
} from './colorRevealConfig'
import { buildColorRevealLayers } from './colorRevealLayers'
import { queueColorRevealBatchExport } from './colorRevealBatchExport'
import './color-reveal.css'
import { usesCustomWatermark } from '../../../shared/watermarkGeometry'
import type { CreativeModuleProps } from '../creativeCatalog'

type ColorRevealStageMode = 'two' | 'three'

export function ColorRevealCreative({ onBack, onAddMedia, onImportLocal, supportedMediaKinds }: CreativeModuleProps) {
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const activeAsset = media.activeMedia
  const allowWatermark = useLunaUltraWatermark(activeAsset)
  const pipeline = edit.pipeline
  const savedState = media.currentProject?.creative?.colorReveal
  const [saturation, setSaturation] = useState(savedState?.saturation ?? DEFAULT_SATURATION)
  const [gray, setGray] = useState(savedGray(savedState))
  const [transitionDuration, setTransitionDuration] = useState(savedState?.transitionDuration ?? DEFAULT_TRANSITION_DURATION)
  const [initialHoldDuration, setInitialHoldDuration] = useState(savedState?.initialHoldDuration ?? DEFAULT_INITIAL_HOLD_DURATION)
  const [midpointHoldDuration, setMidpointHoldDuration] = useState(savedState?.midpointHoldDuration ?? DEFAULT_MIDPOINT_HOLD_DURATION)
  const [stageMode, setStageMode] = useState<ColorRevealStageMode>(savedState?.stageMode ?? DEFAULT_STAGE_MODE)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [duration, setDuration] = useState(0)
  const [borderMetadata, setBorderMetadata] = useState<MediaMetadata | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const projectSaveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const currentTimeRef = useRef(0)
  const isImage = activeAsset?.kind === 'image'
  const trimStart = pipeline.trim?.startTime ?? 0
  const sourceDuration = isImage
    ? IMAGE_CREATIVE_DURATION
    : Math.max(0, (pipeline.trim?.endTime ?? duration) - trimStart)
  const effectStart = initialHoldDuration
  const creativeDuration = colorRevealCreativeDuration(isImage, sourceDuration, effectStart)
  const transitionMax = colorRevealTransitionMax(isImage, creativeDuration, sourceDuration, effectStart, midpointHoldDuration)
  const effectiveTransitionDuration = Math.min(transitionDuration, transitionMax)
  currentTimeRef.current = currentTime

  useEffect(() => {
    const nextSavedState = media.currentProject?.creative?.colorReveal
    setSaturation(nextSavedState?.saturation ?? DEFAULT_SATURATION)
    setGray(savedGray(nextSavedState))
    setTransitionDuration(nextSavedState?.transitionDuration ?? DEFAULT_TRANSITION_DURATION)
    setInitialHoldDuration(nextSavedState?.initialHoldDuration ?? DEFAULT_INITIAL_HOLD_DURATION)
    setMidpointHoldDuration(nextSavedState?.midpointHoldDuration ?? DEFAULT_MIDPOINT_HOLD_DURATION)
    setStageMode(nextSavedState?.stageMode ?? DEFAULT_STAGE_MODE)
  }, [media.currentProject?.id])

  useEffect(() => {
    setCurrentTime(0)
    setPlaying(false)
    setSourceSize(null)
    setDuration(activeAsset?.kind === 'image' ? IMAGE_CREATIVE_DURATION : 0)
    setBorderMetadata(null)
    if (!activeAsset) return
    let cancelled = false
    Promise.all([
      activeAsset.kind === 'image'
        ? loadCreativeImageSize(activeAsset)
        : window.luna.workspace.getMediaResolution(activeAsset.path),
      activeAsset.kind === 'video'
        ? window.luna.workspace.getVideoDuration(activeAsset.path)
        : Promise.resolve(IMAGE_CREATIVE_DURATION),
      window.luna.getMediaMetadataByPath(activeAsset.path).catch(() => ({ groups: [] })),
    ]).then(([size, videoDuration, metadata]) => {
      if (cancelled) return
      setSourceSize(size)
      setDuration(videoDuration)
      setBorderMetadata(metadata)
      setTransitionDuration((value) => Math.min(value, Math.max(0.5, videoDuration)))
    }).catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : '无法读取素材信息')
    })
    return () => { cancelled = true }
  }, [activeAsset?.id, activeAsset?.path])

  useEffect(() => {
    if (!videoElement) return
    const handleEnded = () => setPlaying(false)
    videoElement.addEventListener('ended', handleEnded)
    return () => {
      videoElement.removeEventListener('ended', handleEnded)
    }
  }, [videoElement])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const updatePlayhead = (now: number) => {
      const elapsed = Math.max(0, (now - previous) / 1000)
      previous = now
      const previousTime = currentTimeRef.current
      const nextTime = Math.min(creativeDuration, previousTime + elapsed)
      if (videoElement && previousTime < effectStart && nextTime >= effectStart) {
        videoElement.currentTime = trimStart
      }
      currentTimeRef.current = nextTime
      setCurrentTime(nextTime)
      if (nextTime >= creativeDuration) {
        videoElement?.pause()
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(updatePlayhead)
    }
    frame = requestAnimationFrame(updatePlayhead)
    return () => cancelAnimationFrame(frame)
  }, [creativeDuration, effectStart, playing, trimStart, videoElement])

  useEffect(() => {
    const currentProject = media.currentProject
    if (!currentProject) return
    const nextProject = {
      ...currentProject,
      creative: {
        ...currentProject.creative,
        colorReveal: {
          saturation,
          gray,
          transitionDuration,
          initialHoldDuration,
          midpointHoldDuration,
          stageMode,
        },
      },
    }
    pendingProjectRef.current = nextProject
    media.setCurrentProject(nextProject)
    if (projectSaveTimerRef.current !== null) window.clearTimeout(projectSaveTimerRef.current)
    projectSaveTimerRef.current = window.setTimeout(() => {
      projectSaveTimerRef.current = null
      void window.luna.workspace.saveProject(nextProject).catch(() => {})
    }, 300)
  }, [gray, initialHoldDuration, midpointHoldDuration, saturation, stageMode, transitionDuration])

  useEffect(() => () => {
    if (projectSaveTimerRef.current !== null) window.clearTimeout(projectSaveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => {})
  }, [])

  const outputSize = useMemo(() => sourceSize
    ? outputSizeForTransform(sourceSize, pipeline.transform)
    : null, [pipeline.transform, sourceSize])
  const editedLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return buildWorkspaceExportLayers(activeAsset.path, sourceSize, pipeline, borderMetadata, allowWatermark || usesCustomWatermark(pipeline.watermark))
  }, [activeAsset, allowWatermark, borderMetadata, pipeline, sourceSize])

  const buildEffectLayers = useCallback((forExport: boolean): PreviewLayer[] => {
    if (!activeAsset) return []
    const revealStart = forExport || activeAsset.kind === 'image' ? effectStart : trimStart
    return buildColorRevealLayers({
      sourcePath: activeAsset.path,
      layers: editedLayers,
      isVideo: activeAsset.kind === 'video',
      trimStart,
      sourceDuration,
      effectStart,
      revealStart,
      transitionDuration: effectiveTransitionDuration,
      midpointHoldDuration,
      saturation,
      gray,
      stageMode,
      forExport,
    })
  }, [activeAsset, editedLayers, effectStart, effectiveTransitionDuration, gray, midpointHoldDuration, saturation, sourceDuration, stageMode, trimStart])

  const previewLayers = useMemo(() => buildEffectLayers(false), [buildEffectLayers])
  const handlePreviewError = useCallback((message: string) => toast.error(message), [])
  const exportableIndices = (media.selectedIndices.size > 0
    ? [...media.selectedIndices]
    : [media.activeIndex]
  ).filter((index) => Boolean(media.media[index]) && !media.brokenPaths.has(media.media[index].path))
  const exportCount = exportableIndices.length

  function handleSeek(time: number): void {
    setCurrentTime(time)
    currentTimeRef.current = time
    if (videoElement) videoElement.currentTime = trimStart + Math.max(0, time - effectStart)
  }

  function togglePlayback(): void {
    if (playing) {
      setPlaying(false)
      return
    }
    if (currentTime >= creativeDuration) handleSeek(0)
    setPlaying(true)
  }

  function resetParameters(): void {
    setSaturation(DEFAULT_SATURATION)
    setGray(DEFAULT_GRAY)
    setTransitionDuration(Math.min(DEFAULT_TRANSITION_DURATION, Math.max(0.5, duration || DEFAULT_TRANSITION_DURATION)))
    setInitialHoldDuration(DEFAULT_INITIAL_HOLD_DURATION)
    setMidpointHoldDuration(DEFAULT_MIDPOINT_HOLD_DURATION)
    setStageMode(DEFAULT_STAGE_MODE)
    handleSeek(0)
  }

  async function handleExport(config: VideoExportSettings): Promise<void> {
    if (exporting || exportCount === 0) return
    setExportDialogOpen(false)
    setExporting(true)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
      const sources = exportableIndices.map((index) => {
        const asset = media.media[index]
        return {
          asset,
          pipeline: index === media.activeIndex
            ? pipeline
            : normalizeCreativePipeline((asset as { pipeline?: unknown }).pipeline),
        }
      })
      const count = await queueColorRevealBatchExport({
        sources,
        exportDir: settings.exportDir,
        config,
        saturation,
        gray,
        transitionDuration,
        initialHoldDuration,
        midpointHoldDuration,
        stageMode,
      })
      toast.success(count > 1 ? `已加入导出队列：${count} 个素材` : '已加入生成任务')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '视频生成失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="color-reveal-page">
      <header className="color-reveal-toolbar">
        <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>
          创意列表
        </Button>
        <span>色彩还原</span>
        <WorkspaceMediaImportButtons onAddMedia={onAddMedia} onImportLocal={onImportLocal} />
      </header>

      <div className="color-reveal-preview">
        {activeAsset && outputSize ? (
          <div
            className={`color-reveal-stage ui-video-controls-host ${outputSize.width > outputSize.height ? 'is-landscape' : 'is-portrait'}`}
            style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
          >
            <WebGpuMultiLayerVideoPreview
              className="color-reveal-canvas"
              layers={previewLayers}
              canvasWidth={outputSize.width}
              canvasHeight={outputSize.height}
              playing={playing && currentTime >= effectStart}
              compositionTime={isImage ? currentTime : undefined}
              decodeQuality={1}
              interactiveImageLayerIndexes={[]}
              onVideoElement={setVideoElement}
              onError={handlePreviewError}
            />
            <VideoControls
              currentTime={currentTime}
              duration={creativeDuration}
              playing={playing}
              onToggle={togglePlayback}
              onSeek={handleSeek}
              step={0.01}
            />
          </div>
        ) : (
          <div className="color-reveal-empty">
            <WandSparkles size={28} />
            <strong>选择一个图片或视频素材</strong>
            <span>在下方素材栏中选择需要制作色彩还原的素材</span>
          </div>
        )}
      </div>

      <aside className="color-reveal-panel">
        <div className="color-reveal-panel-head">
          <div>
            <strong>效果设置</strong>
            <span>{stageMode === 'three' ? '灰片过渡到原图，停顿后再呈现调色滤镜' : '灰片曲线过渡到调色滤镜，中段短暂停顿'}</span>
          </div>
        </div>
        <div className="color-reveal-param-list">
          <div className="color-reveal-mode-field">
            <span>变化阶段</span>
            <SegmentedControl
              ariaLabel="色彩变化阶段"
              value={stageMode}
              options={[
                { value: 'two', label: '两段' },
                { value: 'three', label: '三段' },
              ]}
              onChange={setStageMode}
            />
          </div>
          <ParamSlider label="灰片饱和度" value={saturation} min={-100} max={0} onChange={setSaturation} />
          <ParamSlider label="灰度" value={gray} min={0} max={100} onChange={setGray} />
          <ParamSlider
            label="首帧停留"
            value={initialHoldDuration}
            min={0}
            max={3}
            step={0.1}
            onChange={setInitialHoldDuration}
            formatValue={(value) => `${value.toFixed(1)}s`}
          />
          <ParamSlider
            label="曲线变化"
            value={Math.min(transitionDuration, transitionMax)}
            min={0.5}
            max={transitionMax}
            step={0.1}
            onChange={setTransitionDuration}
            formatValue={(value) => `${value.toFixed(1)}s`}
          />
          <ParamSlider
            label="中段停顿"
            value={midpointHoldDuration}
            min={0}
            max={2}
            step={0.1}
            onChange={setMidpointHoldDuration}
            formatValue={(value) => `${value.toFixed(1)}s`}
          />
        </div>
        <div className="color-reveal-actions">
          <IconButton
            variant="ghost"
            size="mini"
            icon={<RotateCcw size={14} />}
            title="重置参数"
            aria-label="重置参数"
            onClick={resetParameters}
          />
          <Button
            variant="primary"
            size="compact"
            icon={<Download size={14} />}
            disabled={exportCount === 0 || exporting}
            onClick={() => setExportDialogOpen(true)}
          >
            {exporting ? '加入中' : exportCount > 1 ? `生成 ${exportCount} 个视频` : '生成视频'}
          </Button>
        </div>
      </aside>

      <div className="color-reveal-media-strip">
        <WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} />
      </div>

      <ExportSettingsDialog
        open={exportDialogOpen}
        tone="dark"
        onOpenChange={setExportDialogOpen}
        title={exportCount > 1 ? `生成 ${exportCount} 个色彩还原视频` : '生成色彩还原视频'}
        description={exportCount > 1 ? '所有选中素材将使用相同的生成设置' : '设置生成视频的分辨率、码率和帧率'}
        loading={exporting}
        confirmLabel="开始生成"
        confirmLoadingLabel="生成中..."
        onConfirm={handleExport}
      />
    </section>
  )
}
