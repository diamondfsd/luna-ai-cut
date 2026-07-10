import { ArrowDown, ArrowUp, Download, Minus, Move, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
import type { CompositionInput, PreviewLayer, VideoExportSettings, WorkspaceMediaAsset } from '../../../shared/types'
import { Button, IconButton, toast } from '../../../ui'
import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { resolveExportConfig } from '../../../components/previewStageExport'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { normalizeCreativePipeline, type CreativeSlotSource } from '../shared/creativeMedia'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../../shared/renderLayerPipeline'
import { ParamSlider } from '../../components/ParamSlider'
import { WM_SRC, watermarkStyleOptionsForDevice } from '../../../shared/watermarkAssets'
import './triple-stitch.css'

// 从 Luna 设备配置读取水印选项（中文 / 标准英文）
const LUNA_WATERMARK_OPTIONS = watermarkStyleOptionsForDevice('luna-ultra')

const CANVAS_WIDTH = 2160
const CANVAS_HEIGHT = 3840
const FPS = 30
const EXPORT_DURATION = 3

// 导出设置已迁移至 ExportSettingsPanel + 弹窗

interface SlotEdit {
  scale: number
  translateX: number
  translateY: number
  startTime: number
}

const DEFAULT_SLOT_EDIT: SlotEdit = { scale: 1, translateX: 0, translateY: 0, startTime: 0 }

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

function useTripleStitchSources(media: WorkspaceMediaAsset[], selectedIds: string[]): CreativeSlotSource[] {
  return useMemo(() => selectedIds
    .map((id) => media.find((asset) => asset.id === id))
    .filter((asset): asset is WorkspaceMediaAsset => Boolean(asset))
    .map((asset) => ({
      asset,
      pipeline: normalizeCreativePipeline((asset as { pipeline?: unknown }).pipeline),
    })), [media, selectedIds])
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

/** 每格视频底部 Logo 宽度（占画布宽比例） */
const SLOT_LOGO_TARGET_WIDTH = 0.33

/** 构建单个 slot 底部居中 Logo 图层 */
function buildSlotLogoLayer(slotIndex: number, imagePath: string, _wmAspect: number): PreviewLayer {
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

function clampPan(value: number, scale: number): number {
  const limit = Math.max(0, (scale - 1) / (scale * 2))
  return Math.min(limit, Math.max(-limit, value))
}

function buildTripleStitchComposition(
  slots: CreativeSlotSource[],
  edits: SlotEdit[],
  lutPaths: (string | undefined)[],
  watermarkInfo: { imagePath: string; wmAspect: number } | null,
): CompositionInput | null {
  if (slots.length !== 3) return null

  const videoLayers = slots.map(({ asset, pipeline }, index) => ({
    id: `slot-${index + 1}`,
    source: {
      path: asset.path,
      sourceType: 'auto' as const,
      time: {
        start: edits[index]?.startTime ?? 0,
        offset: 0,
        duration: EXPORT_DURATION,
        loopEnabled: true,
      },
    },
    rect: { x: 0, y: index / 3, w: 1, h: 1 / 3 },
    fit: 'cover' as const,
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
        const logo = buildSlotLogoLayer(i, watermarkInfo.imagePath, watermarkInfo.wmAspect)
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
    layers: [...videoLayers, ...logoLayers],
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
  const [selectedIds, setSelectedIds] = useState<string[]>(() => media.media.slice(0, 3).map((asset) => asset.id))
  const [activeSlot, setActiveSlot] = useState(0)
  const [slotEdits, setSlotEdits] = useState<SlotEdit[]>([
    { ...DEFAULT_SLOT_EDIT },
    { ...DEFAULT_SLOT_EDIT },
    { ...DEFAULT_SLOT_EDIT },
  ])
  const [previewPlaying, setPreviewPlaying] = useState(true)
  const [busy, setBusy] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const dragRef = useRef<{ slot: number; x: number; y: number; startX: number; startY: number; width: number; height: number } | null>(null)
  const slotSources = useTripleStitchSources(media.media, selectedIds)
  const [composition, setComposition] = useState<CompositionInput | null>(null)
  const compositionVersionRef = useRef(0)

  // ── 水印：从 Luna 设备配置读取，无开关 ──
  const defaultWmStyle = LUNA_WATERMARK_OPTIONS[0]?.value ?? 'luna_ultra_cn'
  const [watermarkStyle, setWatermarkStyle] = useState<string>(defaultWmStyle)
  const [watermarkInfo, setWatermarkInfo] = useState<{ imagePath: string; wmAspect: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.luna.getWatermarkPath(watermarkStyle, 'image')
      .then((info) => {
        if (!cancelled) {
          setWatermarkInfo({
            imagePath: info.filePath,
            wmAspect: info.width / info.height,
          })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [watermarkStyle])

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
    const videoLayers = slotSources.map(({ asset, pipeline }, index) => ({
      filePath: asset.path,
      isVideo: true,
      videoTime: slotEdits[index]?.startTime ?? 0,
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
          buildSlotLogoLayer(i, watermarkInfo.imagePath, watermarkInfo.wmAspect)
        )
      : []

    return [...videoLayers, ...logoLayers]
  }, [slotSources, slotEdits, watermarkInfo])

  // 播放时长控制：3 秒后自动停止
  useEffect(() => {
    if (!previewPlaying) return
    const timer = window.setTimeout(() => {
      setPreviewPlaying(false)
    }, EXPORT_DURATION * 1000)
    return () => window.clearTimeout(timer)
  }, [previewPlaying])
  const activeEdit = slotEdits[activeSlot] ?? DEFAULT_SLOT_EDIT
  const activeAsset = slotSources[activeSlot]?.asset
  const activeDuration = (activeAsset as { duration?: number } | undefined)?.duration
  const startMax = Math.max(0, (typeof activeDuration === 'number' ? activeDuration : 33) - EXPORT_DURATION)

  function pausePreviewForEdit(): void {
    setPreviewPlaying(false)
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
        translateX: clampPan(patch.translateX ?? item.translateX, nextScale),
        translateY: clampPan(patch.translateY ?? item.translateY, nextScale),
        startTime: Math.max(0, patch.startTime ?? item.startTime),
      }
    }))
  }

  function resetActiveSlot(): void {
    updateSlotEdit(activeSlot, DEFAULT_SLOT_EDIT)
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
    setBusy(true)
    setExportDialogOpen(false)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('导出目录未配置')
      const stamp = Date.now()
      const fileName = `triple-stitch-${stamp}.mp4`
      const destinationPath = outputPath(settings.exportDir, fileName)
      const itemId = `triple_stitch_${stamp}`
      const task = await window.luna.exportTask.create('三拼视频导出', [
        { id: itemId, sourcePath: slotSources[0]?.asset.path ?? '', outputPath: destinationPath },
      ])

      // 根据导出配置重新计算画布尺寸，layers 使用归一化坐标无需调整
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

      await compositionApi().exportCompositionVideo(
        destinationPath,
        scaledComposition,
        resolved.fps,
        EXPORT_DURATION,
        true,
        itemId,
        resolved.qualityPreset,
        task.id,
        itemId,
      )
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
        <div className="triple-stitch-board">
          <MultipleLayerVideoPreviewLrcRender
            className="triple-stitch-canvas"
            layers={previewLayers}
            canvasWidth={CANVAS_WIDTH}
            canvasHeight={CANVAS_HEIGHT}
            playing={previewPlaying}
            decodeQuality={1.0}
            onError={(message) => toast.error(message)}
          />
          <div className="triple-stitch-preview-actions">
            <IconButton
              variant="light"
              size="compact"
              icon={previewPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              onClick={() => setPreviewPlaying((current) => !current)}
              title={previewPlaying ? '暂停预览' : '播放预览'}
            />
          </div>
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
              value={activeEdit.translateX}
              min={-0.5}
              max={0.5}
              step={0.001}
              onChange={(translateX) => updateSlotEdit(activeSlot, { translateX })}
              formatValue={(value) => value.toFixed(3)}
            />
            <ParamSlider
              label="垂直"
              value={activeEdit.translateY}
              min={-0.5}
              max={0.5}
              step={0.001}
              onChange={(translateY) => updateSlotEdit(activeSlot, { translateY })}
              formatValue={(value) => value.toFixed(3)}
            />
            <ParamSlider
              label="起始"
              value={activeEdit.startTime}
              min={0}
              max={startMax}
              step={0.1}
              onChange={(startTime) => updateSlotEdit(activeSlot, { startTime })}
              formatValue={(value) => `${value.toFixed(1)}s`}
            />
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

        <div className="triple-stitch-actions">
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!canExport} onClick={() => void handleExport()}>
            {busy ? '导出中' : '导出视频'}
          </Button>
        </div>
      </aside>

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
