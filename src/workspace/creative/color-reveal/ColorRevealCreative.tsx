import { ArrowLeft, Download, RotateCcw, WandSparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
import { resolveExportConfig } from '../../../components/previewStageExport'
import { buildCompositionFromPreviewLayers } from '../../../components/renderComposition'
import type { CompositionInput, MediaMetadata, PreviewLayer, VideoExportSettings } from '../../../shared/types'
import { Button, IconButton, SegmentedControl, VideoControls, toast } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import './color-reveal.css'

const DEFAULT_SATURATION = -80
const DEFAULT_GRAY = 70
const DEFAULT_TRANSITION_DURATION = 2.5
const DEFAULT_INITIAL_HOLD_DURATION = 1
const DEFAULT_MIDPOINT_HOLD_DURATION = 0.6
const DEFAULT_STAGE_MODE = 'three'
type ColorRevealStageMode = 'two' | 'three'
function savedGray(state: { gray?: number; contrast?: number } | undefined): number {
  if (typeof state?.gray === 'number') return state.gray
  if (typeof state?.contrast === 'number') return Math.min(100, state.contrast * 3)
  return DEFAULT_GRAY
}

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
  const trimStart = pipeline.trim?.startTime ?? 0
  const sourceDuration = Math.max(0, (pipeline.trim?.endTime ?? duration) - trimStart)
  const effectStart = initialHoldDuration
  const creativeDuration = sourceDuration + effectStart
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
    return buildWorkspaceExportLayers(activeAsset.path, sourceSize, pipeline, borderMetadata)
  }, [activeAsset, borderMetadata, pipeline, sourceSize])

  const buildEffectLayers = useCallback((forExport: boolean): PreviewLayer[] => {
    if (!activeAsset) return []
    const revealStart = forExport ? effectStart : trimStart
    const mediaLayers = editedLayers.flatMap((layer) => {
      if (!layer.isVideo || layer.filePath !== activeAsset.path) return [layer]
      const afterColor = layer.color
      const beforeColor = afterColor ? {
        ...afterColor,
        saturation: Math.max(-100, Math.min(100, afterColor.saturation + saturation - gray * 0.2)),
        contrast: Math.max(-100, Math.min(100, afterColor.contrast - gray * 0.55)),
        shadows: Math.max(-100, Math.min(100, afterColor.shadows + gray * 0.28)),
        blacks: Math.max(-100, Math.min(100, afterColor.blacks + gray * 0.32)),
        whites: Math.max(-100, Math.min(100, afterColor.whites - gray * 0.22)),
        clarity: Math.max(-100, Math.min(100, afterColor.clarity - gray * 0.18)),
        curveLift: Math.max(-100, Math.min(100, afterColor.curveLift + gray * 0.12)),
      } : afterColor
      const shared = {
        ...layer,
        videoTime: trimStart,
        videoOffset: forExport ? effectStart : undefined,
        videoDuration: sourceDuration || undefined,
        videoSourceKey: 'color-reveal-main',
      }
      const grayLayer: PreviewLayer = {
        ...shared,
        color: beforeColor,
        lutId: undefined,
        lutIntensity: undefined,
      }
      if (stageMode === 'two') {
        return [
          grayLayer,
          {
            ...shared,
            zIndex: layer.zIndex + 0.01,
            reveal: {
              direction: 'left-to-right' as const,
              start: revealStart,
              duration: transitionDuration,
              midpointHold: midpointHoldDuration,
              easing: 'ease-in-out' as const,
            },
          },
        ]
      }

      const halfDuration = transitionDuration / 2
      return [
        grayLayer,
        {
          ...shared,
          color: undefined,
          lutId: undefined,
          lutIntensity: undefined,
          zIndex: layer.zIndex + 0.01,
          reveal: {
            direction: 'left-to-right' as const,
            start: revealStart,
            duration: halfDuration,
            easing: 'ease-in-out' as const,
          },
        },
        {
          ...shared,
          zIndex: layer.zIndex + 0.02,
          reveal: {
            direction: 'left-to-right' as const,
            start: revealStart + halfDuration + midpointHoldDuration,
            duration: halfDuration,
            easing: 'ease-in-out' as const,
          },
        },
      ]
    })
    return mediaLayers
  }, [activeAsset, editedLayers, effectStart, gray, midpointHoldDuration, saturation, sourceDuration, stageMode, transitionDuration, trimStart])

  const previewLayers = useMemo(() => buildEffectLayers(false), [buildEffectLayers])
  const handlePreviewError = useCallback((message: string) => toast.error(message), [])

  function buildExportComposition(width: number, height: number, fps: number | null): CompositionInput {
    if (!activeAsset) throw new Error('请选择一个视频素材')
    const composition = buildCompositionFromPreviewLayers(
      buildEffectLayers(true),
      width,
      height,
      { fps: fps ?? undefined, duration: creativeDuration || undefined },
    )
    composition.canvas.duration = creativeDuration || undefined
    return composition
  }

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
    if (!activeAsset || !outputSize || exporting) return
    setExportDialogOpen(false)
    setExporting(true)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
      const resolved = resolveExportConfig(config, outputSize.width, outputSize.height)
      const stamp = Date.now()
      const fileName = `i-log-color-reveal-${stamp}.mp4`
      const path = outputPath(settings.exportDir, fileName)
      const itemId = `color_reveal_${stamp}`
      const task = await window.luna.exportTask.create('i-log 色彩还原', [{
        id: itemId,
        sourcePath: activeAsset.path,
        outputPath: path,
        label: '创意视频',
      }])
      void renderApi().exportCompositionVideo(
        path,
        buildExportComposition(resolved.width, resolved.height, resolved.fps),
        resolved.fps,
        creativeDuration || null,
        true,
        itemId,
        resolved.qualityPreset,
        task.id,
        itemId,
      ).catch(() => {
        // 失败状态由导出任务服务记录并展示。
      })
      toast.success('已加入导出任务')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '视频生成失败')
    } finally {
      setExporting(false)
    }
  }

  const transitionMax = Math.max(0.5, Math.min(8, sourceDuration || 8))

  return (
    <section className="color-reveal-page">
      <header className="color-reveal-toolbar">
        <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>
          创意列表
        </Button>
        <span>i-log 色彩还原</span>
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
              playing={playing && currentTime >= effectStart}
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
            <strong>选择一个视频素材</strong>
            <span>在下方素材栏中选择需要制作的调色视频</span>
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
        title="生成 i-log 色彩还原视频"
        description="设置生成视频的分辨率、码率和帧率"
        loading={exporting}
        confirmLabel="开始生成"
        confirmLoadingLabel="生成中..."
        onConfirm={handleExport}
      />
    </section>
  )
}
