import { ArrowLeft, Download, RotateCcw, WandSparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
import { resolveExportConfig } from '../../../components/previewStageExport'
import { buildCompositionFromPreviewLayers } from '../../../components/renderComposition'
import type { CompositionInput, MediaMetadata, PreviewLayer, VideoExportSettings } from '../../../shared/types'
import { Button, IconButton, VideoControls, toast } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import './color-reveal.css'

const DEFAULT_SATURATION = -80
const DEFAULT_CONTRAST = 20
const DEFAULT_TRANSITION_DURATION = 2.5

interface LunaCompositionExportApi {
  exportCompositionVideo(
    outputPath: string,
    composition: CompositionInput,
    fps: number | null,
    duration: number | null,
    hardware: boolean,
    taskId?: string,
    qualityPreset?: string,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
}

interface ColorRevealCreativeProps {
  onBack: () => void
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

function renderApi(): LunaCompositionExportApi {
  const api = (window as unknown as { lunaRenderCore?: LunaCompositionExportApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

export function ColorRevealCreative({ onBack }: ColorRevealCreativeProps) {
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const activeAsset = media.activeMedia?.kind === 'video' ? media.activeMedia : null
  const pipeline = edit.pipeline
  const savedState = media.currentProject?.creative?.colorReveal
  const [saturation, setSaturation] = useState(savedState?.saturation ?? DEFAULT_SATURATION)
  const [contrast, setContrast] = useState(savedState?.contrast ?? DEFAULT_CONTRAST)
  const [transitionDuration, setTransitionDuration] = useState(savedState?.transitionDuration ?? DEFAULT_TRANSITION_DURATION)
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

  useEffect(() => {
    const nextSavedState = media.currentProject?.creative?.colorReveal
    setSaturation(nextSavedState?.saturation ?? DEFAULT_SATURATION)
    setContrast(nextSavedState?.contrast ?? DEFAULT_CONTRAST)
    setTransitionDuration(nextSavedState?.transitionDuration ?? DEFAULT_TRANSITION_DURATION)
  }, [media.currentProject?.id])

  useEffect(() => {
    setCurrentTime(0)
    setPlaying(false)
    setSourceSize(null)
    setDuration(0)
    setBorderMetadata(null)
    if (!activeAsset) return
    let cancelled = false
    Promise.all([
      window.luna.workspace.getMediaResolution(activeAsset.path),
      window.luna.workspace.getVideoDuration(activeAsset.path),
      window.luna.getMediaMetadataByPath(activeAsset.path).catch(() => ({ groups: [] })),
    ]).then(([size, videoDuration, metadata]) => {
      if (cancelled) return
      setSourceSize(size)
      setDuration(videoDuration)
      setBorderMetadata(metadata)
      setTransitionDuration((value) => Math.min(value, Math.max(0.5, videoDuration)))
    }).catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : '无法读取视频信息')
    })
    return () => { cancelled = true }
  }, [activeAsset?.id, activeAsset?.path])

  useEffect(() => {
    if (!videoElement) return
    const trimStart = pipeline.trim?.startTime ?? 0
    const trimEnd = pipeline.trim?.endTime ?? duration
    const syncTime = () => {
      const nextTime = Math.max(0, videoElement.currentTime - trimStart)
      setCurrentTime(nextTime)
      if (videoElement.currentTime >= trimEnd && playing) {
        videoElement.pause()
        setPlaying(false)
      }
    }
    const handleEnded = () => setPlaying(false)
    videoElement.addEventListener('timeupdate', syncTime)
    videoElement.addEventListener('seeked', syncTime)
    videoElement.addEventListener('ended', handleEnded)
    return () => {
      videoElement.removeEventListener('timeupdate', syncTime)
      videoElement.removeEventListener('seeked', syncTime)
      videoElement.removeEventListener('ended', handleEnded)
    }
  }, [duration, pipeline.trim?.endTime, pipeline.trim?.startTime, playing, videoElement])

  useEffect(() => {
    if (!playing || !videoElement) return
    let frame = 0
    const updatePlayhead = () => {
      setCurrentTime(Math.max(0, videoElement.currentTime - (pipeline.trim?.startTime ?? 0)))
      frame = requestAnimationFrame(updatePlayhead)
    }
    frame = requestAnimationFrame(updatePlayhead)
    return () => cancelAnimationFrame(frame)
  }, [pipeline.trim?.startTime, playing, videoElement])

  useEffect(() => {
    const currentProject = media.currentProject
    if (!currentProject) return
    const nextProject = {
      ...currentProject,
      creative: {
        ...currentProject.creative,
        colorReveal: { saturation, contrast, transitionDuration },
      },
    }
    pendingProjectRef.current = nextProject
    media.setCurrentProject(nextProject)
    if (projectSaveTimerRef.current !== null) window.clearTimeout(projectSaveTimerRef.current)
    projectSaveTimerRef.current = window.setTimeout(() => {
      projectSaveTimerRef.current = null
      void window.luna.workspace.saveProject(nextProject).catch(() => {})
    }, 300)
  }, [contrast, saturation, transitionDuration])

  useEffect(() => () => {
    if (projectSaveTimerRef.current !== null) window.clearTimeout(projectSaveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => {})
  }, [])

  const outputSize = useMemo(() => sourceSize
    ? outputSizeForTransform(sourceSize, pipeline.transform)
    : null, [pipeline.transform, sourceSize])
  const trimStart = pipeline.trim?.startTime ?? 0
  const effectDuration = Math.max(0, (pipeline.trim?.endTime ?? duration) - trimStart)
  const revealProgress = Math.min(1, Math.max(0, currentTime / Math.max(0.1, transitionDuration)))
  const editedLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return buildWorkspaceExportLayers(activeAsset.path, sourceSize, pipeline, borderMetadata)
  }, [activeAsset, borderMetadata, pipeline, sourceSize])

  const buildEffectLayers = useCallback((forExport: boolean): PreviewLayer[] => {
    if (!activeAsset) return []
    const revealStart = forExport ? 0 : trimStart
    return editedLayers.flatMap((layer) => {
      if (!layer.isVideo || layer.filePath !== activeAsset.path) return [layer]
      const afterColor = layer.color
      const beforeColor = afterColor ? {
        ...afterColor,
        saturation: Math.max(-100, Math.min(100, afterColor.saturation + saturation)),
        contrast: Math.max(-100, Math.min(100, afterColor.contrast + contrast)),
      } : afterColor
      const shared = {
        ...layer,
        videoTime: trimStart,
        videoDuration: effectDuration || undefined,
        videoSourceKey: 'color-reveal-main',
      }
      return [
        { ...shared, color: beforeColor },
        {
          ...shared,
          zIndex: layer.zIndex + 0.01,
          reveal: { direction: 'left-to-right' as const, start: revealStart, duration: transitionDuration },
        },
      ]
    })
  }, [activeAsset, contrast, editedLayers, effectDuration, saturation, transitionDuration, trimStart])

  const previewLayers = useMemo(() => buildEffectLayers(false), [buildEffectLayers])
  const handlePreviewError = useCallback((message: string) => toast.error(message), [])

  function buildExportComposition(width: number, height: number, fps: number | null): CompositionInput {
    if (!activeAsset) throw new Error('请选择一个视频素材')
    return buildCompositionFromPreviewLayers(
      buildEffectLayers(true),
      width,
      height,
      { fps: fps ?? undefined, duration: effectDuration || undefined },
    )
  }

  function handleSeek(time: number): void {
    setCurrentTime(time)
    if (videoElement) videoElement.currentTime = trimStart + time
  }

  function resetParameters(): void {
    setSaturation(DEFAULT_SATURATION)
    setContrast(DEFAULT_CONTRAST)
    setTransitionDuration(Math.min(DEFAULT_TRANSITION_DURATION, Math.max(0.5, duration || DEFAULT_TRANSITION_DURATION)))
    handleSeek(0)
  }

  async function handleExport(config: VideoExportSettings): Promise<void> {
    if (!activeAsset || !outputSize || exporting) return
    setExporting(true)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
      const resolved = resolveExportConfig(config, outputSize.width, outputSize.height)
      const stamp = Date.now()
      const fileName = `color-reveal-${stamp}.mp4`
      const path = outputPath(settings.exportDir, fileName)
      const itemId = `color_reveal_${stamp}`
      const task = await window.luna.exportTask.create('灰片变正片', [{
        id: itemId,
        sourcePath: activeAsset.path,
        outputPath: path,
        label: '创意视频',
      }])
      await renderApi().exportCompositionVideo(
        path,
        buildExportComposition(resolved.width, resolved.height, resolved.fps),
        resolved.fps,
        effectDuration || null,
        true,
        itemId,
        resolved.qualityPreset,
        task.id,
        itemId,
      )
      toast.success('视频已生成')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '视频生成失败')
    } finally {
      setExporting(false)
    }
  }

  const transitionMax = Math.max(0.5, Math.min(8, effectDuration || 8))

  return (
    <section className="color-reveal-page">
      <header className="color-reveal-toolbar">
        <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>
          创意列表
        </Button>
        <span>灰片变正片</span>
      </header>

      <div className="color-reveal-preview">
        {activeAsset && outputSize ? (
          <div
            className="color-reveal-stage ui-video-controls-host"
            style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
          >
            <MultipleLayerVideoPreviewLrcRender
              className="color-reveal-canvas"
              layers={previewLayers}
              canvasWidth={outputSize.width}
              canvasHeight={outputSize.height}
              playing={playing}
              decodeQuality={1}
              interactiveImageLayerIndexes={[]}
              onVideoElement={setVideoElement}
              onError={handlePreviewError}
            />
            {revealProgress > 0 && revealProgress < 1 && (
              <div className="color-reveal-divider" style={{ left: `${revealProgress * 100}%` }} />
            )}
            <div className="color-reveal-label color-reveal-label--before">灰片</div>
            <div className="color-reveal-label color-reveal-label--after">正片</div>
            <VideoControls
              currentTime={currentTime}
              duration={effectDuration}
              playing={playing}
              onToggle={() => setPlaying((value) => !value)}
              onSeek={handleSeek}
              step={0.01}
            />
          </div>
        ) : (
          <div className="color-reveal-empty">
            <WandSparkles size={28} />
            <strong>选择一个视频素材</strong>
            <span>在下方素材栏中选择需要制作的调色视频</span>
          </div>
        )}
      </div>

      <aside className="color-reveal-panel">
        <div className="color-reveal-panel-head">
          <div>
            <strong>效果设置</strong>
            <span>灰片从左向右过渡为当前调色效果</span>
          </div>
        </div>
        <div className="color-reveal-param-list">
          <ParamSlider label="灰片饱和度" value={saturation} min={-100} max={0} onChange={setSaturation} />
          <ParamSlider label="灰片反差" value={contrast} min={0} max={50} onChange={setContrast} />
          <ParamSlider
            label="过渡时长"
            value={Math.min(transitionDuration, transitionMax)}
            min={0.5}
            max={transitionMax}
            step={0.1}
            onChange={setTransitionDuration}
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
            disabled={!activeAsset || !outputSize || exporting}
            onClick={() => setExportDialogOpen(true)}
          >
            {exporting ? '生成中' : '生成视频'}
          </Button>
        </div>
      </aside>

      <div className="color-reveal-media-strip">
        <WorkspaceMediaStrip />
      </div>

      <ExportSettingsDialog
        open={exportDialogOpen}
        tone="dark"
        onOpenChange={setExportDialogOpen}
        title="生成创意视频"
        description="设置生成视频的分辨率、码率和帧率"
        loading={exporting}
        confirmLabel="开始生成"
        confirmLoadingLabel="生成中..."
        onConfirm={handleExport}
      />
    </section>
  )
}
