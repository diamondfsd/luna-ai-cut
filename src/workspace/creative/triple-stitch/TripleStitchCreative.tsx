import { ArrowDown, ArrowUp, Download, Minus, Move, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
import type { CompositionInput, PreviewLayer, VideoExportSettings } from '../../../shared/types'
import { Button, IconButton, VideoControls, toast } from '../../../ui'
import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { resolveExportConfig } from '../../../components/previewStageExport'
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
}

type ExportFormat = 'video' | 'live' | 'appleLive'

const isMac = window.navigator.platform.includes('Mac')

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

/** 每格视频底部 Logo 宽度（占画布宽比例） */
const SLOT_LOGO_TARGET_WIDTH = 0.33

/** 构建单个 slot 底部居中 Logo 图层 */
function buildSlotLogoLayer(slotIndex: number, imagePath: string): PreviewLayer {
  // 用 WatermarkSettings 的 positioning 系统：
  // 以 canvas 底部为锚点，marginY 将 logo 推到各自 slot 的底部
  const marginY = (2 - slotIndex) / 3 + 0.008

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
  // 导出格式多选
  const [exportFormats, setExportFormats] = useState<Set<ExportFormat>>(new Set(['video']))
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
  }, [activeSlot, selectedIds, slotEdits, watermarkStyle, workspaceStateKey])

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
    await window.luna.getSettings().then((s) => {
      if (!s.exportDir) throw new Error('导出目录未配置')
    }).catch((e) => {
      toast.error(e instanceof Error ? e.message : '导出目录未配置')
      return
    })
    setExportDialogOpen(true)
  }

  async function handleExportConfirm(config: VideoExportSettings): Promise<void> {
    if (!composition || busy) return
    if (exportFormats.size === 0) {
      toast.error('请至少选择一种导出格式')
      return
    }
    setBusy(true)
    setExportDialogOpen(false)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('导出目录未配置')
      const stamp = Date.now()
      const baseName = `triple-stitch-${stamp}`
      const videoFileName = `${baseName}.mp4`
      const videoPath = outputPath(settings.exportDir, videoFileName)
      const imageFileName = `${baseName}_frame.jpg`
      const imagePath = outputPath(settings.exportDir, imageFileName)

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

      // 构建子任务列表（视频优先，然后是 live / appleLive）
      const items: Array<{ id: string; sourcePath: string; outputPath: string }> = []
      if (exportFormats.has('video')) {
        items.push({ id: `triple_stitch_video_${stamp}`, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: videoPath })
      }
      if (exportFormats.has('live')) {
        items.push({ id: `triple_stitch_live_${stamp}`, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: outputPath(settings.exportDir, `${baseName}_live.jpg`) })
      }
      if (exportFormats.has('appleLive')) {
        items.push({ id: `triple_stitch_appleLive_${stamp}`, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: outputPath(settings.exportDir, `${baseName}_applevideo.jpg`) })
      }

      const task = await window.luna.exportTask.create('三拼视频导出', items)

      // Step 1: 导出视频（所有格式都需要）
      if (exportFormats.has('video')) {
        await api.exportCompositionVideo(
          videoPath, scaledComposition, resolved.fps, EXPORT_DURATION,
          true, `triple_stitch_video_${stamp}`, resolved.qualityPreset,
          task.id, `triple_stitch_video_${stamp}`,
        )
      } else {
        // 只导出 live/appleLive 时，仍需要视频文件但不作为独立导出项
        await api.exportCompositionVideo(
          videoPath, scaledComposition, resolved.fps, EXPORT_DURATION,
          true, undefined, resolved.qualityPreset,
        )
      }

      // Step 2: 导出 Live 图 / Apple Live 图
      if (exportFormats.has('live') || exportFormats.has('appleLive')) {
        // 导出静态帧作为 cover image
        await api.exportCompositionImage(
          imagePath, scaledComposition, 'jpeg', 100,
          task.id, exportFormats.has('live') ? `triple_stitch_live_${stamp}` : `triple_stitch_appleLive_${stamp}`,
        )

        if (exportFormats.has('live')) {
          try {
            const result = await window.luna.workspace.exportRenderedLivePhoto(
              `${baseName}_live`, imagePath, videoPath, false,
            )
            await window.luna.exportTask.updateItem(task.id, `triple_stitch_live_${stamp}`, {
              status: 'done', progress: 100, destinationPath: result.path,
            }).catch(() => {})
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            await window.luna.exportTask.updateItem(task.id, `triple_stitch_live_${stamp}`, {
              status: 'failed', error: msg,
            }).catch(() => {})
          }
        }

        if (exportFormats.has('appleLive')) {
          try {
            const result = await window.luna.workspace.exportRenderedLivePhoto(
              `${baseName}_appleLive`, imagePath, videoPath, true,
            )
            await window.luna.exportTask.updateItem(task.id, `triple_stitch_appleLive_${stamp}`, {
              status: 'done', progress: 100, destinationPath: result.path,
            }).catch(() => {})
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            await window.luna.exportTask.updateItem(task.id, `triple_stitch_appleLive_${stamp}`, {
              status: 'failed', error: msg,
            }).catch(() => {})
          }
        }
      }

      toast.success('已加入导出任务')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
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

        {/* 导出设置已迁移至弹窗，在点击导出按钮时触发 */}

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
            {(['video', 'live', ...(isMac ? ['appleLive' as ExportFormat] : [])] as ExportFormat[]).map((fmt) => (
              <label key={fmt} className="triple-stitch-export-check">
                <input
                  type="checkbox"
                  checked={exportFormats.has(fmt)}
                  onChange={() => toggleExportFormat(fmt)}
                />
                <span>{fmt === 'video' ? '视频导出' : fmt === 'live' ? 'Live 图导出' : 'Apple Live 图导出'}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="triple-stitch-actions">
          <Button variant="secondary" size="compact" icon={<RotateCcw size={14} />} onClick={resetAllParameters}>
            重置全部
          </Button>
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!canExport} onClick={() => void handleExport()}>
            {busy ? '导出中' : '导出视频'}
          </Button>
        </div>
      </aside>

      <div className="triple-stitch-media-strip">
        <WorkspaceMediaStrip />
      </div>

      <ExportSettingsDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        description="设置导出视频的分辨率、码率和帧率"
        loading={busy}
        confirmLabel="确认导出"
        confirmLoadingLabel="导出中..."
        onConfirm={async (config) => {
          await handleExportConfirm(config)
        }}
      />
    </section>
  )
}
