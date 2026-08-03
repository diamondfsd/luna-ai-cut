import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { DEFAULT_VIDEO_EXPORT_SETTINGS, type VideoExportSettings, type WorkspaceProject } from '../shared/types'
import type { WorkspacePreviewQuality } from '../shared/types/settings'
import { useApp } from '../context/AppContext'
import { ErrorBoundary, toast } from '../ui'
import { ExportSettingsDialog } from '../components/ExportSettingsDialog'
import { isVideoPath } from '../lib/fileUtils'
import { WorkspaceEditProvider, readWorkspacePipelineClipboard, useWorkspaceEdit, writeWorkspacePipelineClipboard } from '../workspace/context/WorkspaceEditContext'
import { WorkspaceMediaProvider, useWorkspaceMedia } from '../workspace/context/WorkspaceMediaContext'
import type { WorkspaceRouteState } from '../workspace/hooks/useProjectManager'
import { WorkspaceCanvasProvider, useWorkspaceCanvas } from '../workspace/context/WorkspaceCanvasContext'
import { WorkspaceMaskProvider, useWorkspaceMask } from '../workspace/context/WorkspaceMaskContext'
import { createDefaultPipeline, DEFAULT_PIPELINE, mergePipeline } from '../workspace/shared/editPipeline'
import type { EditPipeline, PipelinePatch } from '../workspace/shared/editPipeline'
import { updateProjectAssetPipeline } from '../workspace/shared/workspaceProjectPipeline'
import { PreviewStage, type PreviewStageHandle } from '../components/PreviewStage'
import { WorkspaceMediaStrip } from '../workspace/components/WorkspaceMediaStrip'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import { WorkspacePreviewToolbar } from '../workspace/components/WorkspacePreviewToolbar'
import type { WorkspaceViewScale } from '../workspace/components/WorkspacePreviewToolbar'
import { WorkspaceProjectPicker } from '../workspace/components/WorkspaceProjectPicker'
import { WorkspaceRemoveDialog } from '../workspace/components/WorkspaceRemoveDialog'
import { WorkspaceEditSidebar } from '../workspace/components/WorkspaceEditSidebar'
import type { CreativeModeId } from '../workspace/creative/creativeCatalog'
import { WorkspaceCreativeFactory } from '../workspace/creative/WorkspaceCreativeFactory'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import { TrimStrip } from '../workspace/trim/TrimStrip'
import type { LivePhotoSelection } from '../workspace/trim/TrimPanel'
import { buildVideoOutputExportItems, LIVE_PHOTO_DURATION } from '../workspace/trim/videoOutputMarkers'
import { MaskOverlay } from '../workspace/mask/MaskOverlay'
import { useTrimThumbnails } from '../workspace/trim/useTrimThumbnails'
import { buildResolvedWatermarkStaticLayer } from '../components/WatermarkSettings'
import { buildBorderLayer } from '../workspace/border/buildBorderLayer'
import { applyLocalColorToSourceMediaLayers, outputSizeForTransform, pipelineColorToRenderColor, pipelineTransformToRenderTransform, placeWatermarkOnFramedContent } from '../workspace/shared/renderLayerPipeline'
import type { MediaMetadata } from '../shared/types'
import { buildWorkspaceExportLayers } from '../workspace/shared/workspaceExportLayers'
import {
  queueWorkspaceMixedExport,
  summarizeWorkspaceMixedExport,
  type WorkspaceMixedExportPlanItem,
} from '../workspace/shared/workspaceMixedExport'
import { chooseWorkspaceMediaAssets } from '../workspace/shared/workspaceLocalMedia'
import { normalizeWorkspacePreviewQuality, workspacePreviewMaxSide } from '../workspace/shared/workspacePreviewQuality'
import { createWorkspaceDefaultPipeline } from '../workspace/shared/workspaceDefaultPipeline'
import '../styles/workspace-loading.css'
import '../styles/workspace-trim.css'

function normalizePipeline(value: unknown, defaultPipeline: EditPipeline = createDefaultPipeline()): EditPipeline {
  if (!value || typeof value !== 'object') return structuredClone(defaultPipeline)
  return mergePipeline(createDefaultPipeline(), value as PipelinePatch)
}

/** 从 MediaMetadata 中按 key 提取第一个匹配的 EXIF 值 */
function extractExifValue(metadata: MediaMetadata, key: string): string | null {
  for (const group of metadata.groups) {
    for (const entry of group.entries) {
      if (entry.key === key) return entry.value
    }
  }
  return null
}

interface WorkspacePageProps {
  creativeModeId: CreativeModeId | null
  onCreativeModeChange: (modeId: CreativeModeId | null) => void
  pageActive: boolean
}

type WorkspaceRuntimeResource = 'fonts' | 'luts'
const RUNTIME_RESOURCE_RETRY_DELAY_MS = 5_000
const RUNTIME_RESOURCE_MAX_ATTEMPTS = 100

function prepareWorkspaceRuntimeResource(kind: WorkspaceRuntimeResource): Promise<void> {
  const renderCore = (window as unknown as {
    lunaRenderCore?: { prepareRuntimeResource?: (kind: WorkspaceRuntimeResource) => Promise<void> }
  }).lunaRenderCore
  return renderCore?.prepareRuntimeResource?.(kind) ?? Promise.resolve()
}

export function WorkspacePage({ creativeModeId, onCreativeModeChange, pageActive }: WorkspacePageProps) {
  // 非活跃时不渲染：AppRoute 的 preserve 只隐藏不卸载，不跳过会导致 context 消费者持续响应全局 state 变化
  const location = useLocation()
  const routeState = location.state as WorkspaceRouteState | null

  return (
    <WorkspaceEditProvider>
      <WorkspaceMediaProvider routeState={routeState} locationKey={location.key}>
        <WorkspaceCanvasProvider>
          <WorkspaceMaskProvider active={pageActive && (!creativeModeId || creativeModeId === 'pixel-stretch')}>
            <ErrorBoundary>
              <WorkspacePageInner
                creativeModeId={creativeModeId}
                onCreativeModeChange={onCreativeModeChange}
                pageActive={pageActive}
              />
            </ErrorBoundary>
          </WorkspaceMaskProvider>
        </WorkspaceCanvasProvider>
      </WorkspaceMediaProvider>
    </WorkspaceEditProvider>
  )
}

// ── inner page that consumes all three contexts ──

function WorkspacePageInner({ creativeModeId, onCreativeModeChange, pageActive }: WorkspacePageProps) {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const canvas = useWorkspaceCanvas()
  const mask = useWorkspaceMask()
  const { settings, setSettings } = useApp()
  const defaultPipelineRef = useRef(createWorkspaceDefaultPipeline(settings))
  defaultPipelineRef.current = createWorkspaceDefaultPipeline(settings)
  const settingsReady = settings !== null
  const previewRef = useRef<PreviewStageHandle>(null)
  const setVideoFrameTime = mask.setVideoFrameTime
  const trimStateRef = useRef<{ trimActive: boolean; trimEnd: number | null }>({ trimActive: false, trimEnd: null })
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null)
  const [watermarkMediaSize, setWatermarkMediaSize] = useState<{ w: number; h: number } | null>(null)
  const [borderMetadata, setBorderMetadata] = useState<MediaMetadata | null>(null)
  const [exportEnqueuing, setExportEnqueuing] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDialogPlan, setExportDialogPlan] = useState<WorkspaceMixedExportPlanItem[]>([])
  const [exportDialogInitialConfig, setExportDialogInitialConfig] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)
  const [exportDialogDir, setExportDialogDir] = useState('')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [viewScale, setViewScale] = useState<WorkspaceViewScale>('fit')
  const [fitScalePercent, setFitScalePercent] = useState(100)
  const [previewQuality, setPreviewQuality] = useState<WorkspacePreviewQuality>(() => normalizeWorkspacePreviewQuality(settings?.workspacePreviewQuality))
  const [runtimeResourceLoading, setRuntimeResourceLoading] = useState({ fonts: false, luts: false })
  useEffect(() => {
    if (!pageActive) return
    let disposed = false
    const retryTimers: number[] = []

    const prepare = async (kind: WorkspaceRuntimeResource, attempt = 1): Promise<void> => {
      setRuntimeResourceLoading((current) => ({ ...current, [kind]: true }))
      try {
        await prepareWorkspaceRuntimeResource(kind)
        if (!disposed) setRuntimeResourceLoading((current) => ({ ...current, [kind]: false }))
      } catch (error: unknown) {
        if (disposed) return
        const label = kind === 'fonts' ? '字体' : 'LUT'
        if (attempt >= RUNTIME_RESOURCE_MAX_ATTEMPTS) {
          console.warn(`[Workspace] ${label}资源下载连续失败 ${attempt} 次，已停止自动重试:`, error)
          setRuntimeResourceLoading((current) => ({ ...current, [kind]: false }))
          return
        }
        console.warn(`[Workspace] ${label}资源第 ${attempt} 次下载失败，5 秒后重试:`, error)
        retryTimers.push(window.setTimeout(() => {
          void prepare(kind, attempt + 1)
        }, RUNTIME_RESOURCE_RETRY_DELAY_MS))
      }
    }
    void prepare('fonts')
    void prepare('luts')

    return () => {
      disposed = true
      retryTimers.forEach((timer) => window.clearTimeout(timer))
      setRuntimeResourceLoading({ fonts: false, luts: false })
    }
  }, [pageActive])

  useEffect(() => {
    setPreviewQuality(normalizeWorkspacePreviewQuality(settings?.workspacePreviewQuality))
  }, [settings?.workspacePreviewQuality])

  function changePreviewQuality(quality: WorkspacePreviewQuality): void {
    const previous = previewQuality
    setPreviewQuality(quality)
    void window.luna.saveSettings({ workspacePreviewQuality: quality })
      .then(setSettings)
      .catch(() => {
        setPreviewQuality(previous)
        toast.error('无法保存预览清晰度')
      })
  }

  // ── 截取（Trim）状态 ──
  const [trimCurrentTime, setTrimCurrentTime] = useState(0)
  const [trimDuration, setTrimDuration] = useState(0)
  const [trimDurationSourcePath, setTrimDurationSourcePath] = useState<string | null>(null)
  const [trimPlaying, setTrimPlaying] = useState(false)
  const [livePhotoSelection, setLivePhotoSelection] = useState<LivePhotoSelection | null>(null)
  const [activeOutputMarkerId, setActiveOutputMarkerId] = useState<string | null>(null)
  const [playingOutputMarkerId, setPlayingOutputMarkerId] = useState<string | null>(null)
  const markerPlaybackRangeRef = useRef<{
    markerId: string
    startTime: number
    endTime: number
  } | null>(null)
  const activeVideoPath = media.activeMedia?.path && isVideoPath(media.activeMedia.path)
    ? media.activeMedia.path
    : null
  const activeTrimVideoPath = edit.trimActive ? activeVideoPath : null
  const activeVideoPathRef = useRef<string | null>(activeVideoPath)
  activeVideoPathRef.current = activeVideoPath
  const activeTrimDuration = trimDurationSourcePath === activeVideoPath ? trimDuration : 0
  const activeVideoMarker = edit.pipeline.outputMarkers.find((marker): marker is Extract<EditPipeline['outputMarkers'][number], { kind: 'video' }> => (
    marker.kind === 'video' && marker.id === activeOutputMarkerId
  ))
  const activeVideoMarkerRef = useRef(activeVideoMarker)
  activeVideoMarkerRef.current = activeVideoMarker

  useEffect(() => {
    setLivePhotoSelection(null)
    setActiveOutputMarkerId(null)
    setPlayingOutputMarkerId(null)
    markerPlaybackRangeRef.current = null
  }, [activeVideoPath])

  // 同步截取状态到 ref（避免闭包过期）
  useEffect(() => {
    trimStateRef.current = { trimActive: edit.trimActive, trimEnd: edit.pipeline.trim?.endTime ?? null }
  }, [edit.trimActive, edit.pipeline.trim?.endTime])


  const { thumbnails } = useTrimThumbnails({
    videoPath: activeTrimVideoPath,
    duration: activeTrimDuration,
  })

  // 进入项目后如果没有任何素材，自动打开导入弹窗
  const autoImportTriggeredRef = useRef(false)
  useEffect(() => {
    if (media.currentProject && media.media.length === 0 && !autoImportTriggeredRef.current) {
      autoImportTriggeredRef.current = true
      setImportDialogOpen(true)
    }
  }, [media.currentProject, media.media.length])

  // 稳定回调，避免内联箭头函数导致 PreviewStage useEffect 循环
  const handleMediaSize = useCallback((w: number, h: number) => {
    setMediaSize((prev) => {
      if (prev?.w === w && prev?.h === h) return prev
      return { w, h }
    })
  }, [])

  const handlePlayStateChange = useCallback((state: { playing: boolean; currentTime: number; duration: number }) => {
    setTrimPlaying(state.playing)
    setVideoFrameTime(state.currentTime)
    if (state.duration > 0) {
      setTrimDuration(state.duration)
      setTrimDurationSourcePath(activeVideoPathRef.current)
    }

    const markerRange = markerPlaybackRangeRef.current
    const activeVideoRange = activeVideoMarkerRef.current
    // 标记预览优先使用自己的范围，普通播放才受主截取范围限制。
    const trimEnd = trimStateRef.current.trimEnd
    const displayTime = markerRange
      ? Math.max(markerRange.startTime, Math.min(state.currentTime, markerRange.endTime))
      : activeVideoRange
        ? Math.max(activeVideoRange.startTime, Math.min(state.currentTime, activeVideoRange.endTime))
      : trimStateRef.current.trimActive && trimEnd != null
      ? Math.min(state.currentTime, trimEnd)
      : state.currentTime
    setTrimCurrentTime(displayTime)

    if (markerRange && state.playing && state.currentTime >= markerRange.endTime) {
      previewRef.current?.seek(markerRange.startTime)
      markerPlaybackRangeRef.current = null
      setPlayingOutputMarkerId(null)
      if (previewRef.current?.isPlaying()) previewRef.current.togglePlay()
      return
    }
    if (markerRange && !state.playing) {
      markerPlaybackRangeRef.current = null
      setPlayingOutputMarkerId(null)
    }

    // 播放到截取结束时间时自动暂停
    if (!markerRange && trimStateRef.current.trimActive && state.playing && trimEnd != null && trimEnd > 0 && state.currentTime >= trimEnd) {
      previewRef.current?.seek(trimEnd)
      if (!previewRef.current?.isPlaying()) return
      previewRef.current?.togglePlay()
    }
  }, [setVideoFrameTime])


  // ── 截取控制 ──
  const handleTrimSeek = useCallback((time: number) => {
    if (previewRef.current) {
      previewRef.current.seek(time)
    }
    setTrimCurrentTime(time)
  }, [])

  const handleTrimTogglePlay = useCallback(() => {
    if (!previewRef.current) return
    markerPlaybackRangeRef.current = null
    setPlayingOutputMarkerId(null)
    // 如果当前时间在截取范围外（结束位置），回到开始时间再播放
    const trimEnd = trimStateRef.current.trimEnd
    const trimStart = edit.pipeline.trim?.startTime
    if (!previewRef.current.isPlaying() && trimEnd && trimCurrentTime >= trimEnd) {
      previewRef.current.seek(trimStart ?? 0)
    }
    previewRef.current.togglePlay()
  }, [edit.pipeline.trim?.endTime, edit.pipeline.trim?.startTime, trimCurrentTime])

  const handleToggleMarkerPreview = useCallback((marker: Extract<EditPipeline['outputMarkers'][number], { kind: 'video' | 'live' }>) => {
    const preview = previewRef.current
    if (!preview) return
    const active = markerPlaybackRangeRef.current?.markerId === marker.id && preview.isPlaying()
    if (active) {
      markerPlaybackRangeRef.current = null
      setPlayingOutputMarkerId(null)
      preview.togglePlay()
      return
    }
    markerPlaybackRangeRef.current = {
      markerId: marker.id,
      startTime: marker.startTime,
      endTime: marker.endTime,
    }
    setPlayingOutputMarkerId(marker.id)
    preview.seek(marker.startTime)
    setTrimCurrentTime(marker.startTime)
    if (!preview.isPlaying()) preview.togglePlay()
  }, [])

  useEffect(() => {
    const activeRange = markerPlaybackRangeRef.current
    if (!activeRange) return
    if (activeRange.markerId !== activeOutputMarkerId) {
      markerPlaybackRangeRef.current = null
      setPlayingOutputMarkerId(null)
      if (previewRef.current?.isPlaying()) previewRef.current.togglePlay()
      return
    }
    const activeMarker = edit.pipeline.outputMarkers.find((marker) => marker.id === activeRange.markerId)
    if (!activeMarker || activeMarker.kind === 'photo') return
    markerPlaybackRangeRef.current = {
      ...activeRange,
      startTime: activeMarker.startTime,
      endTime: activeMarker.endTime,
    }
  }, [activeOutputMarkerId, edit.pipeline.outputMarkers])

  const handleStartTimeChange = useCallback((time: number) => {
    if (activeVideoMarker) {
      edit.commitPatch({
        outputMarkers: edit.pipeline.outputMarkers.map((marker) => (
          marker.kind === 'video' && marker.id === activeVideoMarker.id
            ? { ...marker, startTime: Math.min(time, marker.endTime - 0.1) }
            : marker
        )),
      })
      return
    }
    edit.commitPatch({ trim: { startTime: time, endTime: edit.pipeline.trim?.endTime ?? activeTrimDuration } })
  }, [activeTrimDuration, activeVideoMarker, edit])

  const handleEndTimeChange = useCallback((time: number) => {
    if (activeVideoMarker) {
      edit.commitPatch({
        outputMarkers: edit.pipeline.outputMarkers.map((marker) => (
          marker.kind === 'video' && marker.id === activeVideoMarker.id
            ? { ...marker, endTime: Math.max(time, marker.startTime + 0.1) }
            : marker
        )),
      })
      return
    }
    edit.commitPatch({ trim: { startTime: edit.pipeline.trim?.startTime ?? 0, endTime: time } })
  }, [activeVideoMarker, edit])

  // ── 当前显示的管线：对比模式时用 comparePipeline（颜色/效果归零） ──
  const displayPipeline = edit.compareOriginal ? edit.comparePipeline : edit.previewPipeline
  const stagePipeline = useMemo(() => {
    const visiblePipeline = edit.compareOriginal
      ? edit.comparePipeline
      : edit.cropActive
        ? mergePipeline(edit.pipeline, {
            transform: {
              ...(edit.transformDraft ?? edit.pipeline.transform),
              crop: null,
            },
          })
        : displayPipeline
    if (!mask.editing || !visiblePipeline.border.enabled) return visiblePipeline
    return mergePipeline(visiblePipeline, {
      border: { ...visiblePipeline.border, enabled: false },
    })
  }, [displayPipeline, edit.compareOriginal, edit.comparePipeline, edit.cropActive, edit.pipeline, edit.transformDraft, mask.editing])
  const keepCompositionVideoRenderer = edit.previewPipeline.colorMasks.some(
    (layer) => layer.enabled && !layer.loadError,
  )

  const finalCanvasSize = useMemo(() => {
    if (!watermarkMediaSize) return null
    return outputSizeForTransform(
      { width: watermarkMediaSize.w, height: watermarkMediaSize.h },
      edit.previewPipeline.transform,
    )
  }, [edit.previewPipeline.transform, watermarkMediaSize])

  // ── 从 pipeline 水印设置自动生成预览层 ──
  const watermarkLayer = useMemo(() => {
    const wm = edit.pipeline.watermark
    if (!wm?.enabled) return []
    if (!finalCanvasSize) return []
    const layer = buildResolvedWatermarkStaticLayer(wm, finalCanvasSize.width, finalCanvasSize.height)
    return layer ? [layer] : []
  }, [edit.pipeline.watermark, finalCanvasSize])

  // ── 边框预览层（JSON 预设解析为多个独立合成层） ──
  const borderLayer = useMemo(() => {
    if (!finalCanvasSize) return []
    const sourcePath = media.activeMedia?.path
    const layers = buildBorderLayer({
      canvasWidth: finalCanvasSize.width,
      canvasHeight: finalCanvasSize.height,
      border: edit.pipeline.border,
      metadata: borderMetadata,
      mediaPath: sourcePath,
      mediaLayerStyle: {
        color: pipelineColorToRenderColor(stagePipeline.color),
        transform: pipelineTransformToRenderTransform(stagePipeline.transform),
        restoreLutId: stagePipeline.logRestore.activeId ?? undefined,
        lutId: stagePipeline.lutFilter.activeId ?? undefined,
        lutIntensity: stagePipeline.lutFilter.intensity,
        isVideo: media.activeMedia?.path ? isVideoPath(media.activeMedia.path) : false,
      },
    })
    return sourcePath
      ? applyLocalColorToSourceMediaLayers(layers, sourcePath, stagePipeline)
      : layers
  }, [edit.pipeline.border, stagePipeline, finalCanvasSize, borderMetadata, media.activeMedia?.path])

  // ── 稳定 extraLayers 引用，避免父组件重渲染时内联展开导致子组件连锁重渲染 ──
  const combinedExtraLayers = useMemo(
    () => edit.cropActive || mask.editing
      ? []
      : [...placeWatermarkOnFramedContent(watermarkLayer, borderLayer), ...borderLayer],
    [edit.cropActive, mask.editing, watermarkLayer, borderLayer],
  )

  // ── Initialize pipeline / reset crop/trim when active asset changes ──
  useLayoutEffect(() => {
    if (!settingsReady) return
    const asset = media.currentProject?.assets[media.activeIndex]
    edit.setCropActive(false)
    edit.setTransformDraft(null)
    edit.setCropPreset('original')
    edit.initializePipeline(normalizePipeline(asset?.pipeline, defaultPipelineRef.current))
    if (media.activeMedia && !isVideoPath(media.activeMedia.path)) {
      // 图片不显示截取，退出截取模式
      if (edit.trimActive) {
        edit.deactivateTrim()
        if (edit.activeTool === 'trim') edit.setActiveTool('filter')
      }
    }
  }, [media.activeIndex, media.activeMedia?.path, media.currentProject?.id, settingsReady])

  useEffect(() => {
    setMediaSize(null)
  }, [media.activeMedia?.path])

  useEffect(() => {
    const filePath = media.activeMedia?.path
    setWatermarkMediaSize(null)
    setBorderMetadata(null)
    if (!filePath) return

    let cancelled = false
    window.luna.workspace.getMediaResolution(filePath)
      .then((resolution) => {
        if (!cancelled) {
          setWatermarkMediaSize({ w: resolution.width, h: resolution.height })
        }
      })
      .catch(() => {
        if (!cancelled) setWatermarkMediaSize(null)
      })

    // 加载 EXIF 元数据（边框需要）
    window.luna.getMediaMetadataByPath(filePath)
      .then((meta) => {
        if (!cancelled) setBorderMetadata(meta)
      })
      .catch(() => {
        if (!cancelled) setBorderMetadata({ groups: [] })
      })

    return () => { cancelled = true }
  }, [media.activeMedia?.path])

  // ── EXIF Make 自动填充边框标题 ──
  useEffect(() => {
    if (!borderMetadata) return
    const makeValue = extractExifValue(borderMetadata, 'Make')
    if (!makeValue) return
    const currentTitle = edit.pipeline.border.title
    if (currentTitle === DEFAULT_PIPELINE.border.title) {
      edit.commitPatch({ border: { title: makeValue } })
    }
  }, [borderMetadata])

  // ── Auto-save project when pipeline changes ──
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectSaveRef = useRef<WorkspaceProject | null>(null)
  const retainedMaskPathsRef = useRef(edit.retainedMaskPaths)
  const setCurrentProject = media.setCurrentProject
  retainedMaskPathsRef.current = edit.retainedMaskPaths
  const flushProjectSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const pending = pendingProjectSaveRef.current
    pendingProjectSaveRef.current = null
    if (!pending) return
    window.luna.workspace.saveProject(pending)
      .then(() => window.luna.workspace.cleanupColorMasks(pending.id, retainedMaskPathsRef.current))
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
  }, [])

  useEffect(() => () => flushProjectSave(), [flushProjectSave])

  useEffect(() => {
    if (!settingsReady) return
    if (creativeModeId) {
      flushProjectSave()
      return
    }
    if (!media.currentProject || !media.activeMedia) return
    if (pendingProjectSaveRef.current?.id !== media.currentProject.id) flushProjectSave()
    const nextProject = updateProjectAssetPipeline(media.currentProject, media.activeIndex, edit.pipeline)
    // Keep the latest pipeline in memory immediately so a sub-500ms asset switch cannot drop it.
    setCurrentProject(nextProject)
    pendingProjectSaveRef.current = nextProject
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(flushProjectSave, 500)
  }, [creativeModeId, edit.pipeline, flushProjectSave, media.activeIndex, media.activeMedia?.path, media.currentProject?.id, setCurrentProject, settingsReady])

  function handlePastePipeline(): void {
    const indices = media.selectedIndices.size > 0 ? media.selectedIndices : new Set([media.activeIndex])
    if (indices.size === 1 && indices.has(media.activeIndex)) {
      edit.pasteToCurrent()
      return
    }

    const data = readWorkspacePipelineClipboard()
    if (!data) {
      toast.error('没有可粘贴的效果')
      return
    }
    const patch: PipelinePatch = {
      color: data.color,
      effects: data.effects,
      logRestore: data.logRestore,
      lutFilter: data.lutFilter,
      watermark: data.watermark,
      border: data.border,
    }
    const targetIndices = new Set([...indices].filter((index) => {
      const asset = media.media[index]
      if (!asset) return false
      if (!data.sourceAssetId || asset.id !== data.sourceAssetId) return true
      return (data.sourceProjectId ?? null) !== (media.currentProject?.id ?? null)
    }))
    if (targetIndices.size === 0) {
      toast.error('没有其他可粘贴的素材')
      return
    }

    if (media.currentProject) {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      pendingProjectSaveRef.current = null
      const nextAssets = media.currentProject.assets.map((asset, i) => {
        if (!targetIndices.has(i)) return asset
        const nextPipeline = mergePipeline(normalizePipeline(asset.pipeline, defaultPipelineRef.current), patch)
        return { ...asset, pipeline: nextPipeline }
      })
      const nextProject = { ...media.currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
      media.setCurrentProject(nextProject)
      window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    } else {
      media.setTransientMedia((current) => current.map((asset, i) => {
        if (!targetIndices.has(i)) return asset
        const nextPipeline = mergePipeline(normalizePipeline((asset as { pipeline?: unknown }).pipeline, defaultPipelineRef.current), patch)
        return { ...asset, pipeline: nextPipeline }
      }))
    }

    if (targetIndices.has(media.activeIndex)) {
      edit.commitPatch(patch)
    }
    toast.success(`已粘贴到 ${targetIndices.size} 个素材`)
  }

  function handleCopyPipeline(): void {
    if (media.selectedIndices.size === 1) {
      const [selectedIndex] = [...media.selectedIndices]
      if (selectedIndex !== media.activeIndex) {
        const asset = media.media[selectedIndex]
        if (!asset) return
        const pipe = normalizePipeline((asset as { pipeline?: unknown }).pipeline, defaultPipelineRef.current)
        writeWorkspacePipelineClipboard({
          sourceAssetId: asset.id,
          sourceProjectId: media.currentProject?.id ?? null,
          color: structuredClone(pipe.color),
          effects: structuredClone(pipe.effects),
          logRestore: structuredClone(pipe.logRestore),
          lutFilter: structuredClone(pipe.lutFilter),
          watermark: structuredClone(pipe.watermark),
          border: structuredClone(pipe.border),
        })
        toast.success('已复制调色、滤镜、水印和边框设置')
        return
      }
    }
    const activeAsset = media.activeMedia
    edit.copyPipeline(activeAsset ? {
      assetId: activeAsset.id,
      projectId: media.currentProject?.id ?? null,
    } : undefined)
  }

  async function handleWorkspaceExport(): Promise<void> {
    if (!media.activeMedia || exportEnqueuing) return
    setExportEnqueuing(true)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) {
        toast.error('导出目录未配置')
        return
      }

      const selectedIndices = media.selectedIndices.size > 0 ? [...media.selectedIndices] : [media.activeIndex]
      const exportIndices = selectedIndices.filter((index) => Boolean(media.media[index]) && !media.brokenPaths.has(media.media[index].path))
      if (exportIndices.length === 0) {
        toast.error('没有可导出的素材')
        return
      }

      const activePipeline = edit.transformDraft
        ? mergePipeline(edit.pipeline, { transform: edit.transformDraft })
        : edit.pipeline
      const trackedActiveMasks = isVideoPath(media.activeMedia.path)
        ? await mask.prepareVideoMasksForExport()
        : activePipeline.colorMasks
      const sourceGroups = await Promise.all(exportIndices.map(async (index): Promise<WorkspaceMixedExportPlanItem[]> => {
        const asset = media.media[index]
        const pipeline = index === media.activeIndex
          ? mergePipeline(activePipeline, { colorMasks: trackedActiveMasks })
          : normalizePipeline((asset as { pipeline?: unknown }).pipeline, defaultPipelineRef.current)
        const resolution = await window.luna.workspace.getMediaResolution(asset.path)
        const sourceDuration = isVideoPath(asset.path)
          ? await window.luna.workspace.getVideoDuration(asset.path).catch(() => 0)
          : 0
        if (isVideoPath(asset.path) && sourceDuration <= 0) {
          throw new Error(`无法读取 ${asset.name} 的视频时长`)
        }
        const trimStart = pipeline.trim?.startTime ?? 0
        const trimEnd = pipeline.trim?.endTime ?? sourceDuration
        const outputBaseName = asset.name.replace(/\.[^.]+$/, '') || 'export'
        const borderMeta = pipeline.border?.enabled
          ? await window.luna.getMediaMetadataByPath(asset.path).catch(() => null)
          : null
        const untrimmedPipeline = isVideoPath(asset.path) ? mergePipeline(pipeline, { trim: null }) : pipeline
        const layers = buildWorkspaceExportLayers(asset.path, resolution, untrimmedPipeline, borderMeta, true)
        const outputSize = outputSizeForTransform(resolution, untrimmedPipeline.transform)

        if (!isVideoPath(asset.path)) {
          return [{
            id: `${asset.id}-image`,
            kind: 'photo',
            sourcePath: asset.path,
            outputBaseName,
            layers,
            outputSize,
          }]
        }

        const markerItems = buildVideoOutputExportItems(outputBaseName, pipeline.outputMarkers, sourceDuration)
        if (markerItems.length !== pipeline.outputMarkers.length) {
          throw new Error(`${asset.name} 有导出标记超出视频范围，请删除后重新添加`)
        }
        const normalizedTrimStart = Math.max(0, Math.min(trimStart, Math.max(0, sourceDuration - 0.1)))
        const normalizedTrimEnd = Math.max(
          normalizedTrimStart + Math.min(0.1, sourceDuration - normalizedTrimStart),
          Math.min(trimEnd, sourceDuration),
        )
        const videoMarkerItems = markerItems.filter((item) => item.kind === 'video')
        const videoItems: WorkspaceMixedExportPlanItem[] = videoMarkerItems.length > 0
          ? videoMarkerItems.map((item) => ({
              id: `${asset.id}-${item.markerId}`,
              kind: 'video',
              sourcePath: asset.path,
              outputBaseName: item.outputBaseName,
              layers,
              outputSize,
              startTime: item.startTime,
              endTime: item.endTime,
            }))
          : [{
              id: `${asset.id}-video`,
              kind: 'video',
              sourcePath: asset.path,
              outputBaseName,
              layers,
              outputSize,
              startTime: normalizedTrimStart,
              endTime: normalizedTrimEnd,
            }]

        const markedItems: WorkspaceMixedExportPlanItem[] = markerItems
          .filter((item) => item.kind !== 'video')
          .map((item) => item.kind === 'photo' ? {
            id: `${asset.id}-${item.markerId}`,
            kind: 'photo',
            sourcePath: asset.path,
            outputBaseName: item.outputBaseName,
            layers,
            outputSize,
            time: item.time,
          } : {
            id: `${asset.id}-${item.markerId}`,
            kind: 'live',
            sourcePath: asset.path,
            outputBaseName: item.outputBaseName,
            layers,
            outputSize,
            startTime: item.startTime,
            endTime: item.endTime,
            coverTime: item.coverTime,
          })
        return [...videoItems, ...markedItems]
      }))
      const plan = sourceGroups.flat()
      const summary = summarizeWorkspaceMixedExport(plan)
      const exportFormats: VideoExportSettings['exportFormats'] = [
        ...(summary.video > 0 ? ['video' as const] : []),
        ...(summary.live > 0 ? ['google-live' as const] : []),
      ]
      setExportDialogPlan(plan)
      setExportDialogInitialConfig({
        ...DEFAULT_VIDEO_EXPORT_SETTINGS,
        exportFormats,
        exportPhotos: summary.photo > 0,
      })
      setExportDialogDir(settings.exportDir)
      setExportDialogOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setExportEnqueuing(false)
    }
  }

  async function handleImportAssets(assets: Parameters<typeof window.luna.workspace.addAssetsToProject>[1]): Promise<void> {
    const existingPaths = new Set(media.media.map((asset) => asset.path))
    const additions = assets.filter((asset) => !existingPaths.has(asset.path))
    if (additions.length === 0) return
    const firstNewIndex = media.media.length
    if (media.currentProject) {
      const project = await window.luna.workspace.addAssetsToProject(media.currentProject.id, additions)
      media.setCurrentProject(project)
    } else {
      media.setTransientMedia((current) => [...current, ...additions])
    }
    media.setSelectedIndices(new Set([firstNewIndex]))
    media.setActiveIndex(firstNewIndex)
  }

  async function handleImportLocalFiles(): Promise<void> {
    try {
      const assets = await chooseWorkspaceMediaAssets(new Set(media.media.map((asset) => asset.path)))
      if (assets.length === 0) return
      await handleImportAssets(assets)
      toast.success(`已导入 ${assets.length} 个本地文件`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入失败')
    }
  }

  // ── Keyboard shortcuts ──
  // Refs for values accessed in stable event listeners
  const cropActiveRef = useRef(false)
  const activeMediaRef = useRef(media.activeMedia)
  const mediaLengthRef = useRef(media.media.length)
  const selectedIndicesRef = useRef(new Set<number>())
  const copyPipelineRef = useRef(handleCopyPipeline)
  const pastePipelineRef = useRef(handlePastePipeline)
  const setCompareOriginalRef = useRef(edit.setCompareOriginal)
  const togglePlayRef = useRef(handleTrimTogglePlay)
  const maskEditingRef = useRef(mask.editing)

  // Sync refs with latest values
  useEffect(() => { cropActiveRef.current = edit.cropActive }, [edit.cropActive])
  useEffect(() => { trimStateRef.current.trimActive = edit.trimActive }, [edit.trimActive])
  useEffect(() => { maskEditingRef.current = mask.editing }, [mask.editing])
  useEffect(() => { activeMediaRef.current = media.activeMedia }, [media.activeMedia])
  useEffect(() => { mediaLengthRef.current = media.media.length }, [media.media.length])
  useEffect(() => { selectedIndicesRef.current = media.selectedIndices }, [media.selectedIndices])
  copyPipelineRef.current = handleCopyPipeline
  pastePipelineRef.current = handlePastePipeline
  setCompareOriginalRef.current = edit.setCompareOriginal
  togglePlayRef.current = handleTrimTogglePlay

  // Stable keyboard handler (registered once, refs keep latest values)
  useEffect(() => {
    if (!pageActive || creativeModeId) return

    function handleKeyDown(event: KeyboardEvent): void {
      // 全局阻止空格默认行为（使用捕获阶段在滑块内部处理前拦截）
      if (event.code === 'Space') {
        event.preventDefault()
        event.stopPropagation()
        const inInput = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
        if (!inInput && activeMediaRef.current) {
          if (trimStateRef.current.trimActive) {
            // 截取模式下空格切换播放/暂停
            togglePlayRef.current()
          } else if (!cropActiveRef.current) {
            setCompareOriginalRef.current(true)
          }
        }
        return
      }

      const inInput = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')
      if (inInput) return
      const hasTextSelection = (window.getSelection()?.toString() ?? '').length > 0
      const workspaceStripActive = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest('.workspace-media-strip'))

      if ((event.code === 'Delete' || event.code === 'Backspace') && activeMediaRef.current && !cropActiveRef.current && !maskEditingRef.current) {
        const removalCount = selectedIndicesRef.current.size || 1
        if (removalCount >= mediaLengthRef.current) return
        event.preventDefault()
        setDeleteConfirmOpen(true)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC' && !cropActiveRef.current) {
        if (hasTextSelection || !workspaceStripActive) return
        if (event.target instanceof HTMLElement && event.target.closest('.ui-video-controls-progress')) return
        event.preventDefault()
        copyPipelineRef.current()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV' && !cropActiveRef.current) {
        if (hasTextSelection || !workspaceStripActive) return
        if (event.target instanceof HTMLElement && event.target.closest('.ui-video-controls-progress')) return
        event.preventDefault()
        pastePipelineRef.current()
        return
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.code === 'Space') {
        event.preventDefault()
        event.stopPropagation()
        if (!trimStateRef.current.trimActive) {
          setCompareOriginalRef.current(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
    }
  }, [creativeModeId, pageActive])

  // ── Empty state — 列表页独立布局，不使用详情页的 workspace-layout 网格 ──
  if (!media.currentProject && media.media.length === 0) {
    return (
      <WorkspaceProjectPicker />
    )
  }

  // ── derive active media readiness for toolbar buttons ──
  const hasActiveMedia = Boolean(media.activeMedia)
  const exportableSelectionIndices = media.selectedIndices.size > 0 ? [...media.selectedIndices] : [media.activeIndex]
  const exportableSelectionCount = exportableSelectionIndices.filter((index) => {
    const asset = media.media[index]
    return Boolean(asset) && !media.brokenPaths.has(asset.path)
  }).length
  const exportButtonText = exportEnqueuing
    ? '加入中'
    : exportableSelectionCount > 1
      ? `导出 ${exportableSelectionCount} 个`
      : '导出'
  const exportDialogSummary = summarizeWorkspaceMixedExport(exportDialogPlan)

  return (
    <div className={`workspace-layout${edit.trimActive ? ' trim-active' : ''}`}>
      {creativeModeId ? (
        <WorkspaceCreativeFactory
          creativeModeId={creativeModeId}
          onCreativeModeChange={onCreativeModeChange}
          onAddMedia={() => setImportDialogOpen(true)}
          onImportLocal={() => void handleImportLocalFiles()}
        />
      ) : (
        <>
          <WorkspacePreviewToolbar
            hasActiveMedia={hasActiveMedia}
            exportEnqueuing={exportEnqueuing}
            exportableSelectionCount={exportableSelectionCount}
            exportButtonText={exportButtonText}
            onImport={() => setImportDialogOpen(true)}
            onImportLocal={() => void handleImportLocalFiles()}
            onExport={() => void handleWorkspaceExport()}
            onCopy={handleCopyPipeline}
            onPaste={handlePastePipeline}
            viewScale={viewScale}
            onViewScaleChange={setViewScale}
            fitScalePercent={fitScalePercent}
            previewQuality={previewQuality}
            onPreviewQualityChange={changePreviewQuality}
          />

          {/* ── Rust/wgpu 预览组件 ── */}
          <PreviewStage
            ref={previewRef}
            url={media.activeMedia?.path ?? null}
            active={pageActive}
            isLivePhoto={media.activeMedia?.isLivePhoto ?? false}
            pending={!media.activeMedia}
            pipeline={stagePipeline}
            extraLayers={combinedExtraLayers}
            cropActive={edit.cropActive}
            hideControls={edit.trimActive}
            onMetricsChange={canvas.setPreviewMetrics}
            onMediaSize={handleMediaSize}
            renderOverlay={() => (edit.cropActive ? <CropOverlay /> : mask.editing ? <MaskOverlay /> : null)}
            viewScale={viewScale}
            onViewScaleChange={setViewScale}
            onFitScaleChange={setFitScalePercent}
            previewMaxSide={workspacePreviewMaxSide(previewQuality)}
            keepCompositionVideoRenderer={keepCompositionVideoRenderer}
            onPlayStateChange={handlePlayStateChange}
          />

          <WorkspaceEditSidebar
            mediaSize={mediaSize}
            duration={activeTrimDuration}
            currentTime={trimCurrentTime}
            onTrimSeek={handleTrimSeek}
            livePhotoSelection={livePhotoSelection}
            onLivePhotoSelectionChange={setLivePhotoSelection}
            activeMarkerId={activeOutputMarkerId}
            onActiveMarkerChange={setActiveOutputMarkerId}
            playingMarkerId={playingOutputMarkerId}
            onToggleMarkerPreview={handleToggleMarkerPreview}
            allowWatermark={Boolean(media.activeMedia)}
            runtimeResourceLoading={runtimeResourceLoading}
            onOpenCreative={onCreativeModeChange}
          />

          {edit.trimActive ? (
            <TrimStrip
              duration={activeTrimDuration}
              startTime={activeVideoMarker?.startTime ?? edit.pipeline.trim?.startTime ?? 0}
              endTime={activeVideoMarker?.endTime ?? edit.pipeline.trim?.endTime ?? activeTrimDuration}
              currentTime={trimCurrentTime}
              playing={trimPlaying}
              onTogglePlay={activeVideoMarker
                ? () => handleToggleMarkerPreview(activeVideoMarker)
                : handleTrimTogglePlay}
              onSeek={handleTrimSeek}
              onStartTimeChange={handleStartTimeChange}
              onEndTimeChange={handleEndTimeChange}
              outputMarkers={edit.pipeline.outputMarkers}
              secondaryFixedRange={livePhotoSelection ? {
                startTime: livePhotoSelection.startTime,
                duration: LIVE_PHOTO_DURATION,
                coverTime: livePhotoSelection.coverTime,
                label: `Live ${String(edit.pipeline.outputMarkers
                  .filter((marker) => marker.kind === 'live')
                  .findIndex((marker) => marker.id === livePhotoSelection.markerId) + 1).padStart(2, '0')}`,
                onStartChange: (startTime) => {
                  const current = livePhotoSelection
                  const delta = startTime - current.startTime
                  const endTime = startTime + LIVE_PHOTO_DURATION
                  const next = {
                    markerId: current.markerId,
                    startTime,
                    endTime,
                    coverTime: Math.max(startTime, Math.min(current.coverTime + delta, endTime - 0.01)),
                  }
                  setLivePhotoSelection(next)
                  edit.commitPatch({
                    outputMarkers: edit.pipeline.outputMarkers.map((marker) => (
                      marker.kind === 'live' && marker.id === current.markerId
                        ? { ...marker, startTime: next.startTime, endTime: next.endTime, coverTime: next.coverTime }
                        : marker
                    )),
                  })
                },
                onCoverTimeChange: (coverTime) => {
                  const current = livePhotoSelection
                  const next = { ...current, coverTime }
                  setLivePhotoSelection(next)
                  edit.commitPatch({
                    outputMarkers: edit.pipeline.outputMarkers.map((marker) => (
                      marker.kind === 'live' && marker.id === current.markerId
                        ? { ...marker, coverTime }
                        : marker
                    )),
                  })
                },
              } : undefined}
              thumbnails={thumbnails}
            />
          ) : null}
          <WorkspaceMediaStrip />
        </>
      )}

      <WorkspaceRemoveDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        selectedCount={media.selectedIndices.size}
        activeName={media.activeMedia?.name ?? ''}
        onConfirm={() => {
          if (media.selectedIndices.size > 1) {
            media.removeSelected(media.selectedIndices)
          } else {
            media.removeMedia(media.activeIndex)
          }
          setDeleteConfirmOpen(false)
        }}
      />

      <WorkspaceImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        existingPaths={new Set(media.media.map((asset) => asset.path))}
        onImport={handleImportAssets}
      />

      <ExportSettingsDialog
        open={exportDialogOpen}
        tone="dark"
        description={exportDialogSummary.text ? `本次包含${exportDialogSummary.text}。` : undefined}
        onOpenChange={setExportDialogOpen}
        initialConfig={exportDialogInitialConfig}
        outputAvailability={{
          video: exportDialogSummary.video > 0,
          photo: exportDialogSummary.photo > 0,
          live: exportDialogSummary.live > 0,
        }}
        onConfirm={async (config) => {
          const result = await queueWorkspaceMixedExport(exportDialogPlan, exportDialogDir, config)
          toast.success(`已加入导出队列: ${result.itemCount} 个结果`)
        }}
      />
    </div>
  )
}
