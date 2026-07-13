import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { WorkspaceProject } from '../shared/types'
import { ErrorBoundary, toast } from '../ui'
import { exportBatchFiles, type BatchExportSource } from '../components/previewStageExport'
import { ExportSettingsDialog } from '../components/ExportSettingsDialog'
import { isVideoPath } from '../lib/fileUtils'
import { WorkspaceEditProvider, readWorkspacePipelineClipboard, useWorkspaceEdit, writeWorkspacePipelineClipboard } from '../workspace/context/WorkspaceEditContext'
import { WorkspaceMediaProvider, useWorkspaceMedia } from '../workspace/context/WorkspaceMediaContext'
import type { WorkspaceRouteState } from '../workspace/hooks/useProjectManager'
import { WorkspaceCanvasProvider, useWorkspaceCanvas } from '../workspace/context/WorkspaceCanvasContext'
import { createDefaultPipeline, DEFAULT_PIPELINE, mergePipeline } from '../workspace/shared/editPipeline'
import type { EditPipeline, PipelinePatch } from '../workspace/shared/editPipeline'
import { PreviewStage, type PreviewStageHandle } from '../components/PreviewStage'
import { WorkspaceMediaStrip } from '../workspace/components/WorkspaceMediaStrip'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import { WorkspacePreviewToolbar } from '../workspace/components/WorkspacePreviewToolbar'
import type { WorkspaceViewScale } from '../workspace/components/WorkspacePreviewToolbar'
import { WorkspaceProjectPicker } from '../workspace/components/WorkspaceProjectPicker'
import { WorkspaceRemoveDialog } from '../workspace/components/WorkspaceRemoveDialog'
import { WorkspaceEditSidebar } from '../workspace/components/WorkspaceEditSidebar'
import type { CreativeModeId, WorkspaceMode } from '../workspace/components/WorkspaceModeHeader'
import { WorkspaceCreativeFactory } from '../workspace/creative/WorkspaceCreativeFactory'
import { CropOverlay } from '../workspace/transform/CropOverlay'
import { TrimStrip } from '../workspace/trim/TrimStrip'
import { useTrimThumbnails } from '../workspace/trim/useTrimThumbnails'
import { buildResolvedWatermarkStaticLayer } from '../components/WatermarkSettings'
import { buildBorderLayer } from '../workspace/border/buildBorderLayer'
import { outputSizeForTransform, pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../workspace/shared/renderLayerPipeline'
import type { MediaMetadata } from '../shared/types'
import { buildWorkspaceExportLayers } from '../workspace/shared/workspaceExportLayers'
import '../styles/workspace-loading.css'
import '../styles/workspace-trim.css'

function normalizePipeline(value: unknown): EditPipeline {
  if (!value || typeof value !== 'object') return createDefaultPipeline()
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
  workspaceMode: WorkspaceMode
  creativeModeId: CreativeModeId | null
  pageActive: boolean
  onEditingChange?: (editing: boolean) => void
}

export function WorkspacePage({ workspaceMode, creativeModeId, pageActive, onEditingChange }: WorkspacePageProps) {
  // 非活跃时不渲染：AppRoute 的 preserve 只隐藏不卸载，不跳过会导致 context 消费者持续响应全局 state 变化
  const location = useLocation()
  const routeState = location.state as WorkspaceRouteState | null

  return (
    <WorkspaceEditProvider>
      <WorkspaceMediaProvider routeState={routeState} locationKey={location.key}>
        <WorkspaceCanvasProvider>
          <ErrorBoundary>
            <WorkspacePageInner
              workspaceMode={workspaceMode}
              creativeModeId={creativeModeId}
              pageActive={pageActive}
              onEditingChange={onEditingChange}
            />
          </ErrorBoundary>
        </WorkspaceCanvasProvider>
      </WorkspaceMediaProvider>
    </WorkspaceEditProvider>
  )
}

// ── inner page that consumes all three contexts ──

function WorkspacePageInner({ workspaceMode, creativeModeId, pageActive, onEditingChange }: WorkspacePageProps) {
  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] WorkspacePageInner render mode=${workspaceMode} creative=${creativeModeId}`)
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const canvas = useWorkspaceCanvas()
  const previewRef = useRef<PreviewStageHandle>(null)
  const trimStateRef = useRef({ trimActive: false, trimEnd: 0 })
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null)
  const [watermarkMediaSize, setWatermarkMediaSize] = useState<{ w: number; h: number } | null>(null)
  const [borderMetadata, setBorderMetadata] = useState<MediaMetadata | null>(null)
  const [exportEnqueuing, setExportEnqueuing] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDialogSources, setExportDialogSources] = useState<BatchExportSource[]>([])
  const [exportDialogDir, setExportDialogDir] = useState('')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [viewScale, setViewScale] = useState<WorkspaceViewScale>('fit')

  // ── 截取（Trim）状态 ──
  const [trimCurrentTime, setTrimCurrentTime] = useState(0)
  const [trimDuration, setTrimDuration] = useState(0)
  const [trimDurationSourcePath, setTrimDurationSourcePath] = useState<string | null>(null)
  const [trimPlaying, setTrimPlaying] = useState(false)
  const activeVideoPath = media.activeMedia?.path && isVideoPath(media.activeMedia.path)
    ? media.activeMedia.path
    : null
  const activeTrimVideoPath = edit.trimActive ? activeVideoPath : null
  const activeVideoPathRef = useRef<string | null>(activeVideoPath)
  activeVideoPathRef.current = activeVideoPath
  const activeTrimDuration = trimDurationSourcePath === activeVideoPath ? trimDuration : 0

  // 同步截取状态到 ref（避免闭包过期）
  useEffect(() => {
    trimStateRef.current = { trimActive: edit.trimActive, trimEnd: edit.pipeline.trim?.endTime ?? 0 }
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
    if (state.duration > 0) {
      setTrimDuration(state.duration)
      setTrimDurationSourcePath(activeVideoPathRef.current)
    }

    // 截取模式下限制当前时间不超过 endTime
    const trimEnd = trimStateRef.current.trimEnd
    const displayTime = trimEnd != null ? Math.min(state.currentTime, trimEnd) : state.currentTime
    setTrimCurrentTime(displayTime)

    // 播放到截取结束时间时自动暂停
    if (trimStateRef.current.trimActive && state.playing && trimEnd > 0 && state.currentTime >= trimEnd) {
      previewRef.current?.seek(trimEnd)
      if (!previewRef.current?.isPlaying()) return
      previewRef.current?.togglePlay()
    }
  }, [])


  // ── 截取控制 ──
  const handleTrimSeek = useCallback((time: number) => {
    if (previewRef.current) {
      previewRef.current.seek(time)
    }
    setTrimCurrentTime(time)
  }, [])

  const handleTrimTogglePlay = useCallback(() => {
    if (!previewRef.current) return
    // 如果当前时间在截取范围外（结束位置），回到开始时间再播放
    const trimEnd = trimStateRef.current.trimEnd
    const trimStart = edit.pipeline.trim?.startTime
    if (!previewRef.current.isPlaying() && trimEnd && trimCurrentTime >= trimEnd) {
      previewRef.current.seek(trimStart ?? 0)
    }
    previewRef.current.togglePlay()
  }, [edit.pipeline.trim?.endTime, edit.pipeline.trim?.startTime, trimCurrentTime])

  const handleStartTimeChange = useCallback((time: number) => {
    edit.commitPatch({ trim: { startTime: time, endTime: edit.pipeline.trim?.endTime ?? activeTrimDuration } })
  }, [edit, activeTrimDuration])

  const handleEndTimeChange = useCallback((time: number) => {
    edit.commitPatch({ trim: { startTime: edit.pipeline.trim?.startTime ?? 0, endTime: time } })
  }, [edit])

  // ── 当前显示的管线：对比模式时用 comparePipeline（颜色/效果归零） ──
  const displayPipeline = edit.compareOriginal ? edit.comparePipeline : edit.previewPipeline
  const stagePipeline = useMemo(() => {
    if (edit.compareOriginal) return edit.comparePipeline
    if (!edit.cropActive) return displayPipeline
    const activeTransform = edit.transformDraft ?? edit.pipeline.transform
    return mergePipeline(edit.pipeline, {
      transform: {
        ...activeTransform,
        crop: null,
      },
    })
  }, [displayPipeline, edit.compareOriginal, edit.comparePipeline, edit.cropActive, edit.pipeline, edit.transformDraft])

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
    console.log('[WorkspacePage] watermark preview layer', {
      filePath: media.activeMedia?.path,
      mediaSize: `${finalCanvasSize.width}x${finalCanvasSize.height}`,
      style: wm.style,
      position: wm.position,
      layer,
    })
    return layer ? [layer] : []
  }, [edit.pipeline.watermark, media.activeMedia?.path, finalCanvasSize])

  // ── 边框预览层（JSON 预设解析为多个独立合成层） ──
  const borderLayer = useMemo(() => {
    if (!finalCanvasSize) return []
    return buildBorderLayer({
      canvasWidth: finalCanvasSize.width,
      canvasHeight: finalCanvasSize.height,
      border: edit.pipeline.border,
      metadata: borderMetadata,
      mediaPath: media.activeMedia?.path,
      mediaLayerStyle: {
        color: pipelineColorToRenderColor(stagePipeline.color),
        transform: pipelineTransformToRenderTransform(stagePipeline.transform),
        lutId: stagePipeline.lutFilter.activeId ?? undefined,
        lutIntensity: stagePipeline.lutFilter.intensity,
        isVideo: media.activeMedia?.path ? isVideoPath(media.activeMedia.path) : false,
      },
    })
  }, [edit.pipeline.border, stagePipeline, finalCanvasSize, borderMetadata, media.activeMedia?.path])

  // ── 稳定 extraLayers 引用，避免父组件重渲染时内联展开导致子组件连锁重渲染 ──
  const combinedExtraLayers = useMemo(
    () => edit.cropActive ? [] : [...watermarkLayer, ...borderLayer],
    [edit.cropActive, watermarkLayer, borderLayer],
  )

  // ── Initialize pipeline / reset crop/trim when active asset changes ──
  useLayoutEffect(() => {
    const asset = media.currentProject?.assets[media.activeIndex]
    edit.setCropActive(false)
    edit.setTransformDraft(null)
    edit.setCropPreset('original')
    edit.initializePipeline(normalizePipeline(asset?.pipeline))
    if (media.activeMedia && !isVideoPath(media.activeMedia.path)) {
      // 图片不显示截取，退出截取模式
      if (edit.trimActive) {
        edit.deactivateTrim()
        if (edit.activeTool === 'trim') edit.setActiveTool('filter')
      }
    }
  }, [media.activeIndex, media.activeMedia?.path, media.currentProject?.id])

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
          console.log('[WorkspacePage] watermark media resolution', {
            filePath,
            width: resolution.width,
            height: resolution.height,
          })
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
  useEffect(() => {
    if (workspaceMode !== 'edit') {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      return
    }
    if (!media.currentProject || !media.activeMedia) return
    const nextProject: WorkspaceProject = {
      ...media.currentProject,
      assets: media.currentProject.assets.map((asset, index) =>
        index === media.activeIndex ? { ...asset, pipeline: edit.pipeline } : asset,
      ),
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      window.luna.workspace.saveProject(nextProject).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
      // 更新内存状态：切回图片时能保留修改后的参数
      media.setCurrentProject(nextProject)
    }, 500)
  }, [media.activeIndex, media.activeMedia?.path, media.currentProject?.id, edit.pipeline, workspaceMode])

  function handlePastePipeline(): void {
    const indices = media.selectedIndices.size > 0 ? media.selectedIndices : new Set([media.activeIndex])
    if (indices.size === 1 && indices.has(media.activeIndex)) {
      edit.pasteToCurrent()
      return
    }

    const data = readWorkspacePipelineClipboard()
    if (!data) {
      toast.error('没有可粘贴的调色设置')
      return
    }
    const patch: PipelinePatch = {
      color: data.color,
      effects: data.effects,
      lutFilter: data.lutFilter,
      watermark: data.watermark,
      border: data.border,
    }

    if (media.currentProject) {
      const nextAssets = media.currentProject.assets.map((asset, i) => {
        if (!indices.has(i)) return asset
        const nextPipeline = mergePipeline(normalizePipeline(asset.pipeline), patch)
        return { ...asset, pipeline: nextPipeline }
      })
      const nextProject = { ...media.currentProject, assets: nextAssets, updatedAt: new Date().toISOString() }
      media.setCurrentProject(nextProject)
      window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    } else {
      media.setTransientMedia((current) => current.map((asset, i) => {
        if (!indices.has(i)) return asset
        const nextPipeline = mergePipeline(normalizePipeline((asset as { pipeline?: unknown }).pipeline), patch)
        return { ...asset, pipeline: nextPipeline }
      }))
    }

    if (indices.has(media.activeIndex)) {
      edit.commitPatch(patch)
    }
    toast.success(`已粘贴到 ${indices.size} 个素材`)
  }

  function handleCopyPipeline(): void {
    if (media.selectedIndices.size === 1) {
      const [selectedIndex] = [...media.selectedIndices]
      if (selectedIndex !== media.activeIndex) {
        const asset = media.media[selectedIndex]
        if (!asset) return
        const pipe = normalizePipeline((asset as { pipeline?: unknown }).pipeline)
        writeWorkspacePipelineClipboard({
          color: structuredClone(pipe.color),
          effects: structuredClone(pipe.effects),
          lutFilter: structuredClone(pipe.lutFilter),
          watermark: structuredClone(pipe.watermark),
          border: structuredClone(pipe.border),
        })
        toast.success('已复制调色、滤镜和水印设置')
        return
      }
    }
    edit.copyPipeline()
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
      const sources: BatchExportSource[] = await Promise.all(exportIndices.map(async (index) => {
        const asset = media.media[index]
        const pipeline = index === media.activeIndex
          ? activePipeline
          : normalizePipeline((asset as { pipeline?: unknown }).pipeline)
        const resolution = await window.luna.workspace.getMediaResolution(asset.path)
        // 加载 EXIF 元数据（边框需要）
        const borderMeta = pipeline.border?.enabled
          ? await window.luna.getMediaMetadataByPath(asset.path).catch(() => null)
          : null
        return {
          sourcePath: asset.path,
          outputBaseName: asset.name.replace(/\.[^.]+$/, '') || 'export',
          layers: buildWorkspaceExportLayers(asset.path, resolution, pipeline, borderMeta),
          outputSize: outputSizeForTransform(resolution, pipeline.transform),
        }
      }))

      // 检查是否有视频素材 → 有则弹窗让用户选择导出参数，否则直接导出
      const hasVideo = sources.some((s) => isVideoPath(s.sourcePath))
      if (hasVideo) {
        setExportDialogSources(sources)
        setExportDialogDir(settings.exportDir)
        setExportDialogOpen(true)
      } else {
        await exportBatchFiles(sources, settings.exportDir)
        toast.success(`已加入导出队列: ${sources.length} 个素材`)
      }
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

  // ── onEditingChange ──
  useEffect(() => {
    onEditingChange?.(media.editorOpen)
    return () => onEditingChange?.(false)
  }, [media.editorOpen, onEditingChange])

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

  // Sync refs with latest values
  useEffect(() => { cropActiveRef.current = edit.cropActive }, [edit.cropActive])
  useEffect(() => { trimStateRef.current.trimActive = edit.trimActive }, [edit.trimActive])
  useEffect(() => { activeMediaRef.current = media.activeMedia }, [media.activeMedia])
  useEffect(() => { mediaLengthRef.current = media.media.length }, [media.media.length])
  useEffect(() => { selectedIndicesRef.current = media.selectedIndices }, [media.selectedIndices])
  copyPipelineRef.current = handleCopyPipeline
  pastePipelineRef.current = handlePastePipeline
  setCompareOriginalRef.current = edit.setCompareOriginal
  togglePlayRef.current = handleTrimTogglePlay

  // Stable keyboard handler (registered once, refs keep latest values)
  useEffect(() => {
    if (!pageActive || workspaceMode !== 'edit') return

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

      if ((event.code === 'Delete' || event.code === 'Backspace') && activeMediaRef.current && !cropActiveRef.current) {
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
  }, [pageActive, workspaceMode])

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

  return (
    <div className={`workspace-layout${edit.trimActive ? ' trim-active' : ''}`}>
      {workspaceMode === 'creative' ? (
        <WorkspaceCreativeFactory creativeModeId={creativeModeId ?? 'triple-stitch'} />
      ) : (
        <>
          <WorkspacePreviewToolbar
            hasActiveMedia={hasActiveMedia}
            exportEnqueuing={exportEnqueuing}
            exportableSelectionCount={exportableSelectionCount}
            exportButtonText={exportButtonText}
            onImport={() => setImportDialogOpen(true)}
            onExport={() => void handleWorkspaceExport()}
            viewScale={viewScale}
            onViewScaleChange={setViewScale}
          />

          {/* ── Rust/wgpu 预览组件 ── */}
          <PreviewStage
            ref={previewRef}
            url={media.activeMedia?.path ?? null}
            pending={!media.activeMedia}
            pipeline={stagePipeline}
            extraLayers={combinedExtraLayers}
            cropActive={edit.cropActive}
            hideControls={edit.trimActive}
            onMetricsChange={canvas.setPreviewMetrics}
            onMediaSize={handleMediaSize}
            renderOverlay={() => (edit.cropActive ? <CropOverlay /> : null)}
            viewScale={viewScale}
            onViewScaleChange={setViewScale}
            onPlayStateChange={handlePlayStateChange}
          />

          <WorkspaceEditSidebar
            mediaSize={mediaSize}
            duration={activeTrimDuration}
          />

          {edit.trimActive ? (
            <TrimStrip
              duration={activeTrimDuration}
              startTime={edit.pipeline.trim?.startTime ?? 0}
              endTime={edit.pipeline.trim?.endTime ?? activeTrimDuration}
              currentTime={trimCurrentTime}
              playing={trimPlaying}
              onTogglePlay={handleTrimTogglePlay}
              onSeek={handleTrimSeek}
              onStartTimeChange={handleStartTimeChange}
              onEndTimeChange={handleEndTimeChange}
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
        onOpenChange={setExportDialogOpen}
        description={`将导出 ${exportDialogSources.length} 个文件`}
        onConfirm={async (config) => {
          await exportBatchFiles(exportDialogSources, exportDialogDir, config)
          toast.success(`已加入导出队列: ${exportDialogSources.length} 个素材`)
        }}
      />
    </div>
  )
}
