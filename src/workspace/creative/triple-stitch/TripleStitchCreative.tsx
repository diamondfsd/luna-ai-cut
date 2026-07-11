import { ArrowDown, ArrowUp, Download, Minus, Move, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../../../shared/types'
import type { CompositionInput, PreviewLayer, VideoExportSettings } from '../../../shared/types'
import { Button, IconButton, VideoControls, toast } from '../../../ui'
import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { emitLocalExportProgress, resolveExportConfig } from '../../../components/previewStageExport'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../../shared/renderLayerPipeline'
import { ParamSlider } from '../../components/ParamSlider'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../../../shared/watermarkAssets'
import { useTripleStitchPlayback } from './useTripleStitchPlayback'
import { useTripleStitchSources, type TripleStitchSource } from './useTripleStitchSources'
import {
  createDefaultSlotEdits,
  DEFAULT_SLOT_EDIT,
  loadTripleStitchState,
  saveTripleStitchState,
  type SlotEdit,
  type TripleStitchSavedState,
} from './tripleStitchState'
import './triple-stitch.css'

// 从 Luna 设备配置读取水印选项（中文 / 标准英文）
const LUNA_WATERMARK_OPTIONS = watermarkStyleOptionsForDevice('luna-ultra')

const CANVAS_WIDTH = 2160
const CANVAS_HEIGHT = 3840
const FPS = 30
const EXPORT_DURATION = 3
const DEFAULT_WATERMARK_STYLE = LUNA_WATERMARK_OPTIONS[0]?.value ?? 'luna_ultra_cn'

// 导出设置已迁移至 ExportSettingsPanel + 弹窗

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
  exportCompositionImage(
    outputPath: string,
    composition: CompositionInput,
    format: string,
    quality: number,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
  getExportTaskProgress?(taskId: string): Promise<[number | bigint, number | bigint] | null>
}

type ExportFormat = 'video' | 'live' | 'appleLive'

const isMac = window.navigator.platform.includes('Mac')

/** 导出格式配置（不含动态 id） */
const EXPORT_FORMATS: Array<{ key: ExportFormat; label: string }> = [
  { key: 'video', label: '视频' },
  { key: 'live', label: 'Live' },
  { key: 'appleLive', label: 'Apple Live' },
]

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 每格视频底部 Logo 宽度（占画布宽比例） */
const SLOT_LOGO_TARGET_WIDTH = 0.33

/** 构建单个 slot 底部居中 Logo 图层 */
function buildSlotLogoLayer(slotIndex: number, imagePath: string): PreviewLayer {
  // 用 WatermarkSettings 的 positioning 系统：
  // 以 canvas 底部为锚点，marginY 将 logo 推到各自 slot 的底部
  const marginY = (2 - slotIndex) / 3 + 0.022

  return {
    filePath: imagePath,
    isVideo: false,
    dstX: 0, dstY: 0, dstW: 1, dstH: 1,
    srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1,
    zIndex: 100 + slotIndex,
    positioning: {
      anchor: 'bottom-center',
      targetWidth: SLOT_LOGO_TARGET_WIDTH,
      marginX: 0.033,
      marginY,
    },
  }
}

function buildTripleStitchComposition(
  slots: TripleStitchSource[],
  edits: SlotEdit[],
  lutPaths: (string | undefined)[],
  watermarkInfo: { imagePath: string } | null,
): CompositionInput | null {
  if (slots.length !== 3 || slots.some(({ sourceReady }) => !sourceReady)) return null

  const mediaLayers = slots.map(({ filePath, isVideo, pipeline }, index) => ({
    id: `slot-${index + 1}`,
    source: {
      path: filePath,
      sourceType: isVideo ? 'video' as const : 'image' as const,
      time: isVideo ? {
        start: edits[index]?.startTime ?? 0,
        offset: 0,
        duration: EXPORT_DURATION,
        loopEnabled: true,
      } : undefined,
    },
    rect: { x: 0, y: index / 3, w: 1, h: 1 / 3 },
    fit: 'cover-scale',
    opacity: 1,
    zIndex: index,
    color: pipelineColorToRenderColor(pipeline.color),
    transform: {
      ...pipelineTransformToRenderTransform(pipeline.transform),
      scale: (pipeline.transform.scale || 1) * (edits[index]?.scale ?? 1),
      translateX: edits[index]?.translateX ?? 0,
      translateY: edits[index]?.translateY ?? 0,
    },
    lutId: lutPaths[index],
    lutIntensity: pipeline.lutFilter.intensity,
  }))

  // 每个 slot 底部固定 Logo（通过 positioning 保持宽高比 + 自动定位到各 slot 底部）
  const logoLayers: CompositionInput['layers'] = watermarkInfo
    ? Array.from({ length: slots.length }, (_, i) => {
        const logo = buildSlotLogoLayer(i, watermarkInfo.imagePath)
        return {
          id: `slot-${i + 1}-logo`,
          source: { path: logo.filePath, sourceType: 'image' as const },
          rect: { x: 0, y: 0, w: 1, h: 1 },
          opacity: 1,
          zIndex: logo.zIndex,
          positioning: logo.positioning as CompositionInput['layers'][number]['positioning'],
        }
      })
    : []

  return {
    version: 1,
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: FPS,
      duration: EXPORT_DURATION,
    },
    layers: [...mediaLayers, ...logoLayers],
  }
}

function compositionApi(): LunaCompositionExportApi {
  const api = (window as unknown as { lunaRenderCore?: LunaCompositionExportApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

export function TripleStitchCreative() {
  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] TripleStitchCreative mount at ${performance.now().toFixed(0)}ms`)
  const media = useWorkspaceMedia()
  const renderCountRef = useRef(0)
  renderCountRef.current++
  // 诊断：每次渲染记录 slotSources 关键字段
  const workspaceStateKey = media.currentProject?.id
    ?? `temporary:${media.media.map((asset) => asset.id).join('|')}`
  const currentProjectRef = useRef(media.currentProject)
  currentProjectRef.current = media.currentProject
  const projectSaveTimerRef = useRef<number | null>(null)
  const initialStateRef = useRef<TripleStitchSavedState | null>(null)
  if (!initialStateRef.current) {
    initialStateRef.current = loadTripleStitchState(
      workspaceStateKey,
      media.media.slice(0, 3).map((asset) => asset.id),
      DEFAULT_WATERMARK_STYLE,
      media.currentProject?.creative?.tripleStitch,
    )
  }
  const initialState = initialStateRef.current
  const [selectedIds, setSelectedIds] = useState<string[]>(initialState.selectedIds)
  const [activeSlot, setActiveSlot] = useState(initialState.activeSlot)
  const [slotEdits, setSlotEdits] = useState<SlotEdit[]>(initialState.slotEdits)
  const previewPlayback = useTripleStitchPlayback(EXPORT_DURATION)
  const [busy, setBusy] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  // 封面帧时间（用于 Live Photo 静帧导出，仅含视频素材时可调）
  const [exportFrameTime, setExportFrameTime] = useState(initialState.exportFrameTime ?? 0)
  // 导出格式多选
  const [exportFormats, setExportFormats] = useState<Set<ExportFormat>>(new Set(['live']))
  const toggleExportFormat = (fmt: ExportFormat) => {
    setExportFormats((prev) => {
      const next = new Set(prev)
      if (next.has(fmt)) next.delete(fmt)
      else next.add(fmt)
      return next
    })
  }
  const dragRef = useRef<{ slot: number; x: number; y: number; startX: number; startY: number; width: number; height: number } | null>(null)
  const slotSources = useTripleStitchSources(media.media, selectedIds)

  // 诊断日志：监控 slotSources 变化（引用变化意味着重新计算了）
  useEffect(() => {
    console.log(
      `[Diag] render#${renderCountRef.current} slotSources 更新，slots:`,
      slotSources.map((s, i) => `[${i}] isVideo=${s.isVideo} isReady=${s.sourceReady} path=${s.filePath?.slice(-20)}`),
      `media.length=${media.media.length}`,
    )
  }, [slotSources])

  const [composition, setComposition] = useState<CompositionInput | null>(null)
  const compositionVersionRef = useRef(0)

  // ── 水印：从 Luna 设备配置读取，无开关 ──
  const [watermarkStyle, setWatermarkStyle] = useState<string>(initialState.watermarkStyle)
  const [watermarkInfo, setWatermarkInfo] = useState<{ imagePath: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.luna.getWatermarkPath(watermarkStyle, 'image')
      .then((info) => {
        if (!cancelled) {
          setWatermarkInfo({
            imagePath: info.filePath,
          })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [watermarkStyle])

  useEffect(() => {
    const state = {
      selectedIds,
      activeSlot,
      slotEdits,
      watermarkStyle,
      exportFrameTime,
    }
    saveTripleStitchState(workspaceStateKey, state)

    const currentProject = currentProjectRef.current
    if (!currentProject) return
    const nextProject = {
      ...currentProject,
      creative: {
        ...currentProject.creative,
        tripleStitch: state,
      },
    }
    currentProjectRef.current = nextProject
    console.log(`[Diag] save effect: setCurrentProject trigger, render#${renderCountRef.current}`)
    media.setCurrentProject(nextProject)
    if (projectSaveTimerRef.current !== null) window.clearTimeout(projectSaveTimerRef.current)
    projectSaveTimerRef.current = window.setTimeout(() => {
      projectSaveTimerRef.current = null
      window.luna.workspace.saveProject(nextProject).catch(() => {})
    }, 300)
  }, [activeSlot, selectedIds, slotEdits, watermarkStyle, exportFrameTime, workspaceStateKey])

  useEffect(() => () => {
    if (projectSaveTimerRef.current === null) return
    window.clearTimeout(projectSaveTimerRef.current)
    const currentProject = currentProjectRef.current
    if (currentProject) void window.luna.workspace.saveProject(currentProject).catch(() => {})
  }, [])

  // 异步构建 composition + 加载 LUT（仅用于导出）
  useEffect(() => {
    const version = ++compositionVersionRef.current
    let cancelled = false
    ;(async () => {
      const lutPaths = slotSources.map((s) => s.pipeline.lutFilter.activeId ?? undefined)
      const result = buildTripleStitchComposition(slotSources, slotEdits, lutPaths, watermarkInfo)
      if (!cancelled && version === compositionVersionRef.current) {
        setComposition(result)
      }
    })()
    return () => { cancelled = true }
  }, [slotSources, slotEdits, watermarkInfo])
  const canExport = Boolean(composition) && !busy

  // 判断是否包含视频素材
  const hasVideoSource = slotSources.some((s) => s.isVideo)

  // 预览层（直接使用前端 <video> 解码，不依赖 composition 构建）
  const previewLayers: PreviewLayer[] = useMemo(() => {
    const mediaLayers = slotSources.map(({ filePath, isVideo, pipeline }, index) => ({
      filePath,
      isVideo,
      fit: 'cover-scale' as const,
      videoTime: (slotEdits[index]?.startTime ?? 0) + previewPlayback.seekTime,
      dstX: 0, dstY: index / 3, dstW: 1, dstH: 1 / 3,
      srcX: 0, srcY: 0, srcW: 1, srcH: 1,
      opacity: 1,
      zIndex: index,
      color: pipelineColorToRenderColor(pipeline.color),
      transform: {
        ...pipelineTransformToRenderTransform(pipeline.transform),
        scale: (pipeline.transform.scale || 1) * (slotEdits[index]?.scale ?? 1),
        translateX: slotEdits[index]?.translateX ?? 0,
        translateY: slotEdits[index]?.translateY ?? 0,
      },
      lutId: pipeline.lutFilter.activeId ?? undefined,
      lutIntensity: pipeline.lutFilter.intensity,
    }))

    // 每个 slot 底部固定 Logo
    const logoLayers: PreviewLayer[] = watermarkInfo
      ? Array.from({ length: slotSources.length }, (_, i) =>
          buildSlotLogoLayer(i, watermarkInfo.imagePath)
        )
      : []

    return [...mediaLayers, ...logoLayers]
  }, [slotSources, slotEdits, watermarkInfo, previewPlayback.seekTime])
  const activeEdit = slotEdits[activeSlot] ?? DEFAULT_SLOT_EDIT
  const activeSource = slotSources[activeSlot]
  const activeDuration = activeSource?.duration
  const startMax = Math.max(0, (typeof activeDuration === 'number' && activeDuration > 0 ? activeDuration : 33) - EXPORT_DURATION)

  function pausePreviewForEdit(): void {
    previewPlayback.pause()
  }

  useEffect(() => {
    setSelectedIds((current) => {
      const valid = current.filter((id) => media.media.some((asset) => asset.id === id))
      const fill = media.media.filter((asset) => !valid.includes(asset.id)).slice(0, 3 - valid.length).map((asset) => asset.id)
      return [...valid, ...fill].slice(0, 3)
    })
  }, [media.media])

  useEffect(() => {
    function handleStripClick(event: Event): void {
      const index = (event as CustomEvent<{ index?: number }>).detail?.index
      if (index == null) return
      const asset = media.media[index]
      if (!asset) return
      pausePreviewForEdit()
      setSelectedIds((current) => {
        const next = [...current]
        next[activeSlot] = asset.id
        return next.slice(0, 3)
      })
      updateSlotEdit(activeSlot, DEFAULT_SLOT_EDIT)
    }

    window.addEventListener('workspace-media-strip-click', handleStripClick)
    return () => window.removeEventListener('workspace-media-strip-click', handleStripClick)
  }, [activeSlot, media.media])

  function updateSlotEdit(slot: number, patch: Partial<SlotEdit>): void {
    pausePreviewForEdit()
    setSlotEdits((current) => current.map((item, index) => {
      if (index !== slot) return item
      const nextScale = Math.min(3, Math.max(1, patch.scale ?? item.scale))
      return {
        ...item,
        ...patch,
        scale: nextScale,
        translateX: patch.translateX ?? item.translateX,
        translateY: patch.translateY ?? item.translateY,
        startTime: Math.max(0, patch.startTime ?? item.startTime),
      }
    }))
  }

  function resetActiveSlot(): void {
    updateSlotEdit(activeSlot, DEFAULT_SLOT_EDIT)
  }

  function resetAllParameters(): void {
    setSelectedIds([])
    setSlotEdits(createDefaultSlotEdits())
    setActiveSlot(0)
    setWatermarkStyle(DEFAULT_WATERMARK_STYLE)
    previewPlayback.reset()
  }

  function nudgeActiveScale(delta: number): void {
    updateSlotEdit(activeSlot, { scale: activeEdit.scale + delta })
  }

  function moveActiveSlot(delta: -1 | 1): void {
    const target = activeSlot + delta
    if (target < 0 || target > 2) return
    pausePreviewForEdit()
    setSelectedIds((current) => {
      const next = [...current]
      ;[next[activeSlot], next[target]] = [next[target], next[activeSlot]]
      return next
    })
    setSlotEdits((current) => {
      const next = [...current]
      ;[next[activeSlot], next[target]] = [next[target], next[activeSlot]]
      return next
    })
    setActiveSlot(target)
  }

  function stopToolEvent(event: PointerEvent | MouseEvent): void {
    event.stopPropagation()
  }

  function slotFromPointer(event: PointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect()
    const y = Math.min(rect.height - 1, Math.max(0, event.clientY - rect.top))
    return Math.floor(y / (rect.height / 3))
  }

  function handleBoardPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    pausePreviewForEdit()
    const slot = slotFromPointer(event)
    const rect = event.currentTarget.getBoundingClientRect()
    const current = slotEdits[slot] ?? DEFAULT_SLOT_EDIT
    setActiveSlot(slot)
    dragRef.current = {
      slot,
      x: event.clientX,
      y: event.clientY,
      startX: current.translateX,
      startY: current.translateY,
      width: rect.width,
      height: rect.height / 3,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleBoardPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (!drag) return
    const edit = slotEdits[drag.slot] ?? DEFAULT_SLOT_EDIT
    updateSlotEdit(drag.slot, {
      translateX: drag.startX + (event.clientX - drag.x) / drag.width,
      translateY: drag.startY + (event.clientY - drag.y) / drag.height,
      scale: edit.scale,
    })
  }

  function handleBoardPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  async function handleExport(): Promise<void> {
    if (!composition || busy) return
    if (exportFormats.size === 0) {
      toast.error('请至少选择一种导出格式')
      return
    }
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('导出目录未配置')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出目录未配置')
      return
    }

    if (exportFormats.has('video')) {
      setExportDialogOpen(true)
      return
    }
    await handleExportConfirm(DEFAULT_VIDEO_EXPORT_SETTINGS)
  }

  async function handleExportConfirm(config: VideoExportSettings): Promise<void> {
    if (!composition || busy) return
    if (exportFormats.size === 0) {
      toast.error('请至少选择一种导出格式')
      return
    }
    setBusy(true)
    setExportDialogOpen(false)
    let activeTask: { id: string; items: Array<{ id: string; outputPath: string }> } | null = null
    const emitTaskProgress = (
      taskId: string,
      items: Array<{ id: string; outputPath: string }>,
      itemId: string,
      progress: number,
      status: 'queued' | 'exporting' | 'done' | 'failed',
      error?: string,
      destinationPath?: string,
    ): void => {
      const item = items.find((candidate) => candidate.id === itemId)
      const path = destinationPath ?? item?.outputPath ?? ''
      emitLocalExportProgress({
        exportId: itemId,
        taskId,
        taskName: '三拼创意导出',
        fileName: path.split(/[/\\]/).pop() || '三拼导出',
        index: Math.max(0, items.findIndex((candidate) => candidate.id === itemId)),
        totalFiles: items.length,
        percent: progress,
        status,
        destinationPath: path,
        error,
      })
    }
    const reportTaskFailure = async (error: unknown): Promise<void> => {
      const message = error instanceof Error ? error.message : String(error)
      const taskContext = activeTask
      if (taskContext) {
        const taskSnapshot = await window.luna.exportTask.get(taskContext.id).catch(() => undefined)
        await Promise.all(taskContext.items.map(({ id: itemId }) => {
          const status = taskSnapshot?.items.find((item) => item.id === itemId)?.status
          if (status !== 'queued' && status !== 'exporting') return Promise.resolve()
          emitTaskProgress(taskContext.id, taskContext.items, itemId, 100, 'failed', message)
          return window.luna.exportTask.updateItem(taskContext.id, itemId, {
            status: 'failed',
            error: message,
          }).catch(() => {})
        }))
      }
      toast.error(message)
    }
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('导出目录未配置')
      const exportDir = settings.exportDir
      const stamp = Date.now()
      const baseName = `triple-stitch-${stamp}`
      const videoFileName = `${baseName}.mp4`
      const videoPath = outputPath(exportDir, videoFileName)

      const resolved = resolveExportConfig(config, CANVAS_WIDTH, CANVAS_HEIGHT)
      const scaledComposition: CompositionInput = {
        ...composition,
        canvas: {
          ...composition.canvas,
          width: resolved.width,
          height: resolved.height,
          fps: resolved.fps ?? composition.canvas.fps,
        },
      }

      const api = compositionApi()

      const videoTaskId = `triple_stitch_video_${stamp}`

      // 子任务列表：只展示用户勾选的格式，中间视频不暴露
      const items = [
        ...(exportFormats.has('video') ? [{ id: videoTaskId, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: videoPath, label: '视频' }] : []),
        ...(exportFormats.has('live') ? [{ id: `triple_stitch_live_${stamp}`, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: outputPath(exportDir, `${baseName}_live.jpg`), label: 'Live' }] : []),
        ...(exportFormats.has('appleLive') ? [{ id: `triple_stitch_appleLive_${stamp}`, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: outputPath(exportDir, `${baseName}_appleLive.jpg`), label: 'Apple Live' }] : []),
      ]

      const task = await window.luna.exportTask.create('三拼创意导出', items)
      activeTask = { id: task.id, items }

      items.forEach((item) => emitTaskProgress(task.id, items, item.id, 0, 'queued'))

      // 页面只负责把导出加入任务队列；实际导出状态由右上角全局任务入口展示。
      setBusy(false)
      toast.success('已加入导出任务')

      void (async () => {
      const liveItemIds = [
        ...(exportFormats.has('live') ? [`triple_stitch_live_${stamp}`] : []),
        ...(exportFormats.has('appleLive') ? [`triple_stitch_appleLive_${stamp}`] : []),
      ]
      const reportLiveProgress = async (progress: number): Promise<void> => {
        await Promise.all(liveItemIds.map((itemId) => {
          emitTaskProgress(task.id, items, itemId, progress, 'exporting')
          return window.luna.exportTask.updateItem(task.id, itemId, {
            status: 'exporting',
            progress,
          }).catch(() => {})
        }))
      }

      // Step 1: 导出视频（用户选了视频 → 展示进度；仅作为 Live 中间素材 → 静默渲染）
      const videoReportTaskId = exportFormats.has('video') ? task.id : undefined
      const videoReportItemId = exportFormats.has('video') ? videoTaskId : undefined
      let stopLiveProgress = false
      const liveProgressWatcher = liveItemIds.length > 0 ? (async () => {
        await reportLiveProgress(1)
        let lastProgress = 1
        while (!stopLiveProgress) {
          const progress = await api.getExportTaskProgress?.(videoTaskId).catch(() => null)
          if (progress) {
            const currentFrame = Number(progress[0])
            const totalFrames = Number(progress[1])
            if (totalFrames > 0) {
              const nextProgress = Math.max(1, Math.min(60, Math.floor((currentFrame / totalFrames) * 60)))
              if (nextProgress > lastProgress) {
                lastProgress = nextProgress
                await reportLiveProgress(nextProgress)
              }
            }
          }
          await wait(300)
        }
      })() : null
      try {
        await api.exportCompositionVideo(
          videoPath, scaledComposition, resolved.fps, EXPORT_DURATION,
          true,
          videoTaskId,
          resolved.qualityPreset,
          videoReportTaskId,
          videoReportItemId,
        )
      } finally {
        stopLiveProgress = true
        await liveProgressWatcher?.catch(() => {})
      }
      if (liveItemIds.length > 0) await reportLiveProgress(60)

      // Live 与 Apple Live 共享同一个视频和同一张封面，缓存文件在封装后继续保留。
      const sharedLiveImagePath = outputPath(exportDir, `${baseName}_live-frame.jpg`)
      if (liveItemIds.length > 0) {
        await window.luna.workspace.extractVideoFrame(videoPath, sharedLiveImagePath, exportFrameTime)
        await reportLiveProgress(75)
      }

      // Step 2: 导出 Live 图 / Apple Live 图
      // 封装服务只清理内部工作副本，不删除上面的共享视频和封面。
      if (exportFormats.has('live')) {
        const liveItemId = `triple_stitch_live_${stamp}`
        await window.luna.exportTask.updateItem(task.id, liveItemId, { status: 'exporting', progress: 85 }).catch(() => {})
        try {
          await window.luna.exportTask.updateItem(task.id, liveItemId, { status: 'exporting', progress: 90 }).catch(() => {})
          const result = await window.luna.workspace.exportRenderedLivePhoto(
            `${baseName}_live`, sharedLiveImagePath, videoPath, false, true,
          )
          await window.luna.exportTask.updateItem(task.id, liveItemId, {
            status: 'done', progress: 100, destinationPath: result.path,
          }).catch(() => {})
          emitTaskProgress(task.id, items, liveItemId, 100, 'done', undefined, result.path)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          await window.luna.exportTask.updateItem(task.id, `triple_stitch_live_${stamp}`, {
            status: 'failed', error: msg,
          }).catch(() => {})
          emitTaskProgress(task.id, items, liveItemId, 100, 'failed', msg)
        }
      }

      if (exportFormats.has('appleLive')) {
        const appleItemId = `triple_stitch_appleLive_${stamp}`
        await window.luna.exportTask.updateItem(task.id, appleItemId, { status: 'exporting', progress: 85 }).catch(() => {})
        try {
          await window.luna.exportTask.updateItem(task.id, appleItemId, { status: 'exporting', progress: 90 }).catch(() => {})
          const result = await window.luna.workspace.exportRenderedLivePhoto(
            `${baseName}_appleLive`, sharedLiveImagePath, videoPath, true, true,
          )
          await window.luna.exportTask.updateItem(task.id, appleItemId, {
            status: 'done', progress: 100, destinationPath: result.path,
          }).catch(() => {})
          emitTaskProgress(task.id, items, appleItemId, 100, 'done', undefined, result.path)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          await window.luna.exportTask.updateItem(task.id, `triple_stitch_appleLive_${stamp}`, {
            status: 'failed', error: msg,
          }).catch(() => {})
          emitTaskProgress(task.id, items, appleItemId, 100, 'failed', msg)
        }
      }
      })().catch(reportTaskFailure)
    } catch (error) {
      await reportTaskFailure(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="triple-stitch-page">
      <div className="triple-stitch-preview">
        <div className="triple-stitch-board ui-video-controls-host">
          <MultipleLayerVideoPreviewLrcRender
            className="triple-stitch-canvas"
            layers={previewLayers}
            canvasWidth={CANVAS_WIDTH}
            canvasHeight={CANVAS_HEIGHT}
            playing={previewPlayback.playing}
            decodeQuality={1.0}
            onError={(message) => toast.error(message)}
          />
          <div
            className="triple-stitch-slot-overlay"
            onPointerDown={handleBoardPointerDown}
            onPointerMove={handleBoardPointerMove}
            onPointerUp={handleBoardPointerUp}
            onPointerCancel={handleBoardPointerUp}
          >
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className={`triple-stitch-slot${activeSlot === index ? ' active' : ''}`}
              >
                <button
                  type="button"
                  className="triple-stitch-slot-hit"
                  onClick={() => setActiveSlot(index)}
                >
                  <span>{index + 1}</span>
                </button>
                {activeSlot === index && (
                  <div className="triple-stitch-slot-tools">
                    <IconButton
                      className="triple-stitch-move-tool"
                      variant="light"
                      size="mini"
                      icon={<Move size={13} />}
                      title="拖动画面"
                    />
                    <IconButton
                      variant="light"
                      size="mini"
                      icon={<Plus size={13} />}
                      onPointerDown={stopToolEvent}
                      onClick={(event) => {
                        stopToolEvent(event)
                        nudgeActiveScale(0.08)
                      }}
                      title="放大"
                    />
                    <IconButton
                      variant="light"
                      size="mini"
                      icon={<Minus size={13} />}
                      onPointerDown={stopToolEvent}
                      onClick={(event) => {
                        stopToolEvent(event)
                        nudgeActiveScale(-0.08)
                      }}
                      title="缩小"
                    />
                    <IconButton
                      variant="light"
                      size="mini"
                      icon={<RotateCcw size={13} />}
                      onPointerDown={stopToolEvent}
                      onClick={(event) => {
                        stopToolEvent(event)
                        resetActiveSlot()
                      }}
                      title="重置"
                    />
                    <IconButton
                      variant="light"
                      size="mini"
                      icon={<ArrowUp size={13} />}
                      disabled={index === 0}
                      onPointerDown={stopToolEvent}
                      onClick={(event) => {
                        stopToolEvent(event)
                        moveActiveSlot(-1)
                      }}
                      title="上移"
                    />
                    <IconButton
                      variant="light"
                      size="mini"
                      icon={<ArrowDown size={13} />}
                      disabled={index === 2}
                      onPointerDown={stopToolEvent}
                      onClick={(event) => {
                        stopToolEvent(event)
                        moveActiveSlot(1)
                      }}
                      title="下移"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <VideoControls
            currentTime={previewPlayback.currentTime}
            duration={EXPORT_DURATION}
            playing={previewPlayback.playing}
            onSeek={previewPlayback.seek}
            onToggle={previewPlayback.toggle}
            step={0.01}
          />
        </div>
      </div>

      <aside className="triple-stitch-panel">
        <div className="triple-stitch-panel-head">
          <div>
            <strong>画面调整</strong>
            <span>点击底部素材替换当前画面</span>
          </div>
        </div>

        <div className="triple-stitch-section">
          <div className="triple-stitch-section-head">
            <div className="triple-stitch-section-title">第 {activeSlot + 1} 画面</div>
            <IconButton
              variant="ghost"
              size="mini"
              icon={<RotateCcw size={13} />}
              onClick={resetActiveSlot}
              title="重置"
            />
          </div>
          <div
            className="triple-stitch-param-list"
            onFocusCapture={pausePreviewForEdit}
            onPointerDownCapture={pausePreviewForEdit}
          >
            <ParamSlider
              label="缩放"
              value={activeEdit.scale}
              min={1}
              max={3}
              step={0.01}
              onChange={(scale) => updateSlotEdit(activeSlot, { scale })}
              formatValue={(value) => `${value.toFixed(2)}x`}
            />
            <ParamSlider
              label="水平"
              value={activeEdit.translateX * 100}
              min={-100}
              max={100}
              step={0.1}
              onChange={(translateX) => updateSlotEdit(activeSlot, { translateX: translateX / 100 })}
              formatValue={(value) => value.toFixed(1)}
            />
            <ParamSlider
              label="垂直"
              value={activeEdit.translateY * 100}
              min={-100}
              max={100}
              step={0.1}
              onChange={(translateY) => updateSlotEdit(activeSlot, { translateY: translateY / 100 })}
              formatValue={(value) => value.toFixed(1)}
            />
            {activeSource?.isVideo && (
              <ParamSlider
                label="起始"
                value={activeEdit.startTime}
                min={0}
                max={startMax}
                step={0.1}
                onChange={(startTime) => updateSlotEdit(activeSlot, { startTime })}
                formatValue={(value) => `${value.toFixed(1)}s`}
              />
            )}
          </div>
        </div>

        {LUNA_WATERMARK_OPTIONS.length > 0 && (
          <div className="triple-stitch-section">
            <div className="triple-stitch-section-title">水印</div>
            <div className="triple-stitch-watermark-toggle">
              {LUNA_WATERMARK_OPTIONS.map((opt) => {
                const thumbSrc = WM_SRC[opt.value]?.image
                return (
                  <button
                    key={opt.value}
                    className={`triple-stitch-wm-btn${watermarkStyle === opt.value ? ' active' : ''}`}
                    onClick={() => setWatermarkStyle(opt.value)}
                  >
                    {thumbSrc && <img src={thumbSrc} alt={opt.label} />}
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="triple-stitch-section">
          <div className="triple-stitch-section-title">导出格式</div>
          <div className="triple-stitch-export-formats">
            {EXPORT_FORMATS.filter((f) => isMac || f.key !== 'appleLive').map((f) => (
              <label key={f.key} className={`triple-stitch-export-chip${exportFormats.has(f.key) ? ' active' : ''}`}>
                <input
                  type="checkbox"
                  checked={exportFormats.has(f.key)}
                  onChange={() => toggleExportFormat(f.key)}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
          {hasVideoSource && (exportFormats.has('live') || exportFormats.has('appleLive')) && (
            <div className="triple-stitch-param-list" style={{ marginTop: 8 }}>
              <ParamSlider
                label="封面帧"
                value={exportFrameTime}
                min={0}
                max={EXPORT_DURATION}
                step={0.01}
                onChange={(v) => {
                  setExportFrameTime(v)
                  previewPlayback.seek(v)
                }}
                formatValue={(value) => `${value.toFixed(2)}s`}
              />
            </div>
          )}
        </div>

        <div className="triple-stitch-actions">
          <Button variant="secondary" size="compact" icon={<RotateCcw size={14} />} onClick={resetAllParameters}>
            重置全部
          </Button>
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!canExport} onClick={() => void handleExport()}>
            导出
          </Button>
        </div>
      </aside>

      <div className="triple-stitch-media-strip">
        <WorkspaceMediaStrip />
      </div>

      <ExportSettingsDialog
        open={exportDialogOpen}
        tone="dark"
        onOpenChange={setExportDialogOpen}
        description="设置导出视频的分辨率、码率和帧率"
        loading={false}
        confirmLabel="确认导出"
        confirmLoadingLabel="加入中..."
        onConfirm={async (config) => {
          await handleExportConfirm(config)
        }}
      />
    </section>
  )
}
