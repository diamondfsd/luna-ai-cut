import { ArrowDown, ArrowUp, Download, Minus, Move, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
import type { CompositionInput, PreviewLayer, WorkspaceMediaAsset } from '../../../shared/types'
import { Button, IconButton, Select, toast } from '../../../ui'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { normalizeCreativePipeline, type CreativeSlotSource } from '../shared/creativeMedia'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from '../../shared/renderLayerPipeline'
import { ParamSlider } from '../../components/ParamSlider'
import './triple-stitch.css'

const CANVAS_WIDTH = 2160
const CANVAS_HEIGHT = 3840
const FPS = 30
const EXPORT_DURATION = 3

type VideoQuality = 'high' | 'medium' | 'low'

const VIDEO_QUALITY_OPTIONS: Array<{ value: VideoQuality; label: string }> = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

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

function clampPan(value: number, scale: number): number {
  const limit = Math.max(0, (scale - 1) / (scale * 2))
  return Math.min(limit, Math.max(-limit, value))
}

function buildTripleStitchComposition(
  slots: CreativeSlotSource[],
  edits: SlotEdit[],
  lutPaths: (string | undefined)[],
): CompositionInput | null {
  if (slots.length !== 3) return null
  return {
    version: 1,
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      fps: FPS,
      duration: EXPORT_DURATION,
    },
    layers: slots.map(({ asset, pipeline }, index) => ({
      id: `slot-${index + 1}`,
      source: {
        path: asset.path,
        sourceType: 'auto',
        time: {
          start: edits[index]?.startTime ?? 0,
          offset: 0,
          duration: EXPORT_DURATION,
          loopEnabled: true,
        },
      },
      rect: { x: 0, y: index / 3, w: 1, h: 1 / 3 },
      fit: 'cover',
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
    })),
  }
}


function compositionApi(): LunaCompositionExportApi {
  const api = (window as unknown as { lunaRenderCore?: LunaCompositionExportApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

export function TripleStitchCreative() {
  console.log(`[Perf] TripleStitchCreative mount at ${performance.now().toFixed(0)}ms`)
  const media = useWorkspaceMedia()
  const [selectedIds, setSelectedIds] = useState<string[]>(() => media.media.slice(0, 3).map((asset) => asset.id))
  const [activeSlot, setActiveSlot] = useState(0)
  const [slotEdits, setSlotEdits] = useState<SlotEdit[]>([
    { ...DEFAULT_SLOT_EDIT },
    { ...DEFAULT_SLOT_EDIT },
    { ...DEFAULT_SLOT_EDIT },
  ])
  const [previewPlaying, setPreviewPlaying] = useState(true)
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('high')
  const [busy, setBusy] = useState(false)
  const dragRef = useRef<{ slot: number; x: number; y: number; startX: number; startY: number; width: number; height: number } | null>(null)
  const slotSources = useTripleStitchSources(media.media, selectedIds)
  const [composition, setComposition] = useState<CompositionInput | null>(null)
  const compositionVersionRef = useRef(0)

  // 异步构建 composition + 加载 LUT（仅用于导出）
  useEffect(() => {
    const version = ++compositionVersionRef.current
    let cancelled = false
    ;(async () => {
      const lutPaths = slotSources.map((s) => s.pipeline.lutFilter.activeId ?? undefined)
      const result = buildTripleStitchComposition(slotSources, slotEdits, lutPaths)
      if (!cancelled && version === compositionVersionRef.current) {
        setComposition(result)
      }
    })()
    return () => { cancelled = true }
  }, [slotSources, slotEdits])
  const canExport = Boolean(composition) && !busy

  // 预览层（直接使用前端 <video> 解码，不依赖 composition 构建）
  const previewLayers: PreviewLayer[] = useMemo(() => {
    return slotSources.map(({ asset, pipeline }, index) => ({
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
  }, [slotSources, slotEdits])

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
    setBusy(true)
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
      await compositionApi().exportCompositionVideo(
        destinationPath,
        composition,
        FPS,
        EXPORT_DURATION,
        true,
        itemId,
        videoQuality,
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

        <div className="triple-stitch-section">
          <div className="triple-stitch-section-title">视频设置</div>
          <div className="triple-stitch-select-row">
            <span>质量</span>
            <Select
              variant="compact"
              options={VIDEO_QUALITY_OPTIONS}
              value={videoQuality}
              onValueChange={(value) => setVideoQuality(value as VideoQuality)}
            />
          </div>
        </div>

        <div className="triple-stitch-actions">
          <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!canExport} onClick={() => void handleExport()}>
            {busy ? '导出中' : '导出视频'}
          </Button>
        </div>
      </aside>
    </section>
  )
}
