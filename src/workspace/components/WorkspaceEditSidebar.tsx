import { ArrowLeft, Captions, Check, Crop, Eraser, Image, ImagePlus, Loader2, Paintbrush, RotateCcw, ScanFace, Scissors, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Accordion, Button, Dialog, IconButton, Tooltip } from '../../ui'
import { createDefaultPipeline, DEFAULT_PIPELINE, HSL_CHANNELS } from '../shared/editPipeline'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { ColorMaskPanel } from '../color/ColorMaskPanel'
import { FilterPanel } from '../lut/FilterPanel'
import { TransformPanel, type CropPreset } from '../transform/TransformPanel'
import { WorkspaceAiCompositionPanel } from '../transform/WorkspaceAiCompositionPanel'
import { frameAspect } from '../transform/cropGeometry'
import { WatermarkSettings } from '../../components/WatermarkSettings'
import type { WatermarkSettings as WatermarkSettingsType } from '../../shared/types'
import type { EditPipeline } from '../shared/editPipeline'
import { BorderPanel } from '../border/BorderPanel'
import { TrimPanel, type LivePhotoSelection } from '../trim/TrimPanel'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useDeviceConnection } from '../../context/DeviceConnectionContext'
import { borderTitleForDevice } from '../../shared/insta360DeviceProfiles'
import { RemovalPanel } from '../removal/RemovalPanel'
import { WorkspaceCreativePanel } from '../creative/WorkspaceCreativeFactory'
import type { CreativeModeId } from '../creative/creativeCatalog'
import { BeautyPanel } from '../beauty/BeautyPanel'
import { SubtitlePanel } from '../subtitles/SubtitlePanel'

export type WorkspaceTool = 'beauty' | 'border' | 'color' | 'creative' | 'crop' | 'trim' | 'watermark' | 'filter' | 'mask' | 'removal' | 'subtitles'

/** 检查当前 pipeline 的调色参数是否有任何修改 */
function isColorModified(color: typeof DEFAULT_PIPELINE.color): boolean {
  const d = DEFAULT_PIPELINE.color
  return (
    color.exposure !== d.exposure ||
    color.temperature !== d.temperature ||
    color.tint !== d.tint ||
    color.contrast !== d.contrast ||
    color.vibrance !== d.vibrance ||
    color.saturation !== d.saturation ||
    color.shadows !== d.shadows ||
    color.highlights !== d.highlights ||
    color.whites !== d.whites ||
    color.blacks !== d.blacks ||
    color.gradeShadowsAmount !== d.gradeShadowsAmount ||
    color.gradeMidAmount !== d.gradeMidAmount ||
    color.gradeHighlightsAmount !== d.gradeHighlightsAmount ||
    color.levelsBlack !== d.levelsBlack ||
    color.levelsGray !== d.levelsGray ||
    color.levelsWhite !== d.levelsWhite ||
    color.customHslChannels.length > 0 ||
    HSL_CHANNELS.some((channel) => {
      const current = color.hslChannels[channel.key]
      return current.hueShift !== 0 || current.saturation !== 0 || current.luminance !== 0
    }) ||
    color.clarity !== d.clarity ||
    color.texture !== d.texture ||
    color.sharpen !== d.sharpen ||
    color.denoise !== d.denoise ||
    color.glowStrength !== d.glowStrength ||
    Object.values(color.curve.points).some((points) => points.length > 0)
  )
}

function isFilterModified(lutFilter: typeof DEFAULT_PIPELINE.lutFilter): boolean {
  return lutFilter.activeId !== null
}

function isCropModified(transform: typeof DEFAULT_PIPELINE.transform): boolean {
  return (
    transform.crop !== null ||
    transform.rotate !== 0 ||
    transform.orientation !== 0 ||
    transform.flipH ||
    transform.flipV ||
    transform.scale !== 1
  )
}

function isWatermarkModified(watermark: typeof DEFAULT_PIPELINE.watermark): boolean {
  return watermark.enabled === true
}

function isBorderModified(border: typeof DEFAULT_PIPELINE.border): boolean {
  return border.enabled === true
}

function isTrimModified(trim: typeof DEFAULT_PIPELINE.trim): boolean {
  return trim !== null
}

const BEAUTY_ENABLED = import.meta.env.VITE_BEAUTY !== 'false'
const TOOL_ITEMS: Array<{ value: WorkspaceTool; label: string; icon: JSX.Element }> = [
  { value: 'color', label: '调色与蒙版', icon: <SlidersHorizontal size={22} /> },
  { value: 'filter', label: 'Lut', icon: <Paintbrush size={22} /> },
  ...(BEAUTY_ENABLED ? [{ value: 'beauty' as const, label: '美颜', icon: <ScanFace size={22} /> }] : []),
  { value: 'removal', label: '对象消除', icon: <Eraser size={22} /> },
  { value: 'crop', label: '裁剪工具', icon: <Crop size={24} /> },
  { value: 'trim', label: '截取', icon: <Scissors size={22} /> },
  { value: 'subtitles', label: '字幕', icon: <Captions size={22} /> },
  { value: 'watermark', label: '水印', icon: <ImagePlus size={22} /> },
  { value: 'border', label: '边框', icon: <Image size={22} strokeWidth={1.8} /> },
  { value: 'creative', label: '创意', icon: <Sparkles size={22} /> },
]

function titleForTool(tool: WorkspaceTool): string {
  if (tool === 'crop') return '裁剪工具'
  if (tool === 'trim') return '截取'
  if (tool === 'subtitles') return '字幕'
  if (tool === 'watermark') return '水印'
  if (tool === 'border') return '边框'
  if (tool === 'filter') return 'Lut'
  if (tool === 'beauty') return '美颜'
  if (tool === 'removal') return '对象消除'
  if (tool === 'creative') return '创意'
  return '调色与蒙版'
}

interface WorkspaceEditSidebarProps {
  mediaSize?: { w: number; h: number } | null
  duration: number
  currentTime: number
  onTrimSeek: (time: number) => void
  livePhotoSelection: LivePhotoSelection | null
  onLivePhotoSelectionChange: (selection: LivePhotoSelection | null) => void
  activeMarkerId: string | null
  onActiveMarkerChange: (markerId: string | null) => void
  playingMarkerId: string | null
  onToggleMarkerPreview: (marker: Extract<EditPipeline['outputMarkers'][number], { kind: 'video' | 'live' }>) => void
  allowWatermark: boolean
  runtimeResourceLoading?: { fonts: boolean; luts: boolean }
  onOpenCreative: (modeId: CreativeModeId) => void
}

export function WorkspaceEditSidebar({ mediaSize, duration, currentTime, onTrimSeek, livePhotoSelection, onLivePhotoSelectionChange, activeMarkerId, onActiveMarkerChange, playingMarkerId, onToggleMarkerPreview, allowWatermark, runtimeResourceLoading, onOpenCreative }: WorkspaceEditSidebarProps) {
  const edit = useWorkspaceEdit()
  const canvas = useWorkspaceCanvas()
  const mediaCtx = useWorkspaceMedia()
  const mask = useWorkspaceMask()
  const { activeDevice, devices, isConnected } = useDeviceConnection()
  const refH = mediaSize?.h ?? 2160
  const cropWidth = edit.cropSize.width || Math.round(canvas.sourceAspect * refH)
  const cropHeight = edit.cropSize.height || refH
  const cropAspectRatio = useMemo(() => {
    if (edit.cropPreset === 'free') return null
    if (edit.cropPreset === 'original') return frameAspect(canvas.sourceAspect, edit.activeTransform.orientation)
    return cropWidth / Math.max(cropHeight, 1)
  }, [canvas.sourceAspect, cropHeight, cropWidth, edit.activeTransform.orientation, edit.cropPreset])
  const defaultBorderTitle = borderTitleForDevice(
    isConnected && activeDevice
      ? { sourceDeviceId: activeDevice.id, sourceDeviceName: activeDevice.name, cameraType: activeDevice.name, watermarkProfileId: activeDevice.id }
      : mediaCtx.activeMedia ?? {},
  ) ?? ''
  const mediaDevice = mediaCtx.activeMedia?.sourceDeviceId
    ? devices.find((device) => device.id === mediaCtx.activeMedia?.sourceDeviceId)
    : undefined
  const restoreLut = mediaDevice
    ? mediaDevice.lut?.restore
    : (isConnected ? activeDevice?.lut?.restore : undefined)

  // 滤镜搜索关键字
  const [filterSearchKey, setFilterSearchKey] = useState('')
  const [resetColorDialogOpen, setResetColorDialogOpen] = useState(false)
  const setActiveTool = edit.setActiveTool
  const setMaskEditing = mask.setEditing
  const beautyAllowed = mediaCtx.activeMedia?.kind !== 'video'
  const activeTool = (edit.activeTool === 'watermark' && !allowWatermark)
    || (edit.activeTool === 'beauty' && !beautyAllowed)
    ? 'color'
    : edit.activeTool
  const visibleToolItems = useMemo(
    () => allowWatermark ? TOOL_ITEMS : TOOL_ITEMS.filter((item) => item.value !== 'watermark'),
    [allowWatermark],
  )

  useEffect(() => {
    if (!allowWatermark && edit.activeTool === 'watermark') {
      setMaskEditing(false)
      setActiveTool('color')
    }
  }, [allowWatermark, edit.activeTool, setActiveTool, setMaskEditing])

  useEffect(() => {
    if (!beautyAllowed && edit.activeTool === 'beauty') setActiveTool('color')
  }, [beautyAllowed, edit.activeTool, setActiveTool])

  useEffect(() => {
    if (edit.activeTool === 'subtitles' && mediaCtx.activeMedia?.kind !== 'video') {
      setActiveTool('color')
    }
  }, [edit.activeTool, mediaCtx.activeMedia?.kind, setActiveTool])

  // 各面板是否有未保存的修改
  const toolModified = useMemo(() => ({
    filter: isFilterModified(edit.pipeline.lutFilter),
    beauty: edit.pipeline.beautyMasks.length > 0,
    color: isColorModified(edit.pipeline.color) || edit.pipeline.colorMasks.some((layer) => isColorModified(layer.color)),
    crop: isCropModified(edit.pipeline.transform),
    trim: isTrimModified(edit.pipeline.trim) || edit.pipeline.outputMarkers.length > 0,
    watermark: isWatermarkModified(edit.pipeline.watermark),
    border: isBorderModified(edit.pipeline.border),
    creative: false,
    mask: edit.pipeline.colorMasks.length > 0,
    removal: Boolean(mediaCtx.currentProject?.assets[mediaCtx.activeIndex]?.removal?.operations.length),
    subtitles: Boolean(mediaCtx.currentProject?.assets[mediaCtx.activeIndex]?.subtitles?.cues.length),
  }), [edit.pipeline, mediaCtx.activeIndex, mediaCtx.currentProject?.assets])

  // 保存水印设置到 pipeline（同时产生预览层和撤销记录）
  const handleWatermarkChange = useMemo(
    () => (watermarkSettings: WatermarkSettingsType) => {
      edit.commitPatch({ watermark: watermarkSettings as EditPipeline['watermark'] })
    },
    [edit.commitPatch],
  )

  // Wrap crop preset/size handlers to inject sourceAspect from canvas context
  const onCropPresetChange = useMemo(
    () => (preset: CropPreset) => edit.handleCropPresetChange(preset, canvas.sourceAspect, mediaSize ?? undefined),
    [edit.handleCropPresetChange, canvas.sourceAspect, mediaSize],
  )
  const onCropSizeChange = useMemo(
    () => (size: { width?: number; height?: number }) => edit.handleCropSizeChange(size, canvas.sourceAspect, mediaSize ?? undefined),
    [edit.handleCropSizeChange, canvas.sourceAspect, mediaSize],
  )

  const resetAllColor = () => {
    edit.commitPatch({
      color: DEFAULT_PIPELINE.color,
      effects: DEFAULT_PIPELINE.effects,
      colorMasks: [],
    })
    mask.setActiveLayerId(null)
    mask.setEditing(false)
    mask.setSemanticPicking(false)
    setResetColorDialogOpen(false)
  }

  const requestResetAllColor = () => {
    if (edit.pipeline.colorMasks.length > 0) {
      setResetColorDialogOpen(true)
      return
    }
    resetAllColor()
  }

  return (
    <aside className="workspace-edit-sidebar">
      <section className="workspace-tool-panel">
        <header className="workspace-tool-panel-header">
          {activeTool === 'filter' ? (
            <>
              <h2 className="filter-panel-title">Lut</h2>
              <label className="filter-search-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M10.8 18.1a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6Z" stroke="currentColor" strokeWidth="2" />
                  <path d="m16.2 16.2 4.3 4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  placeholder="搜索 Lut"
                  value={filterSearchKey}
                  onChange={(e) => setFilterSearchKey(e.target.value)}
                />
              </label>
            </>
          ) : activeTool === 'color' && mask.editing ? (
            <>
              <IconButton
                variant="ghost"
                size="mini"
                className="workspace-mask-editor-back"
                icon={<ArrowLeft size={20} />}
                aria-label="退出蒙版编辑"
                onClick={() => { mask.setEditing(false); mask.setSemanticPicking(false) }}
              />
              <h2>{mask.activeMask ? `编辑蒙版 · ${mask.activeMask.name}` : '新建蒙版'}</h2>
            </>
          ) : (
            <h2>{titleForTool(activeTool)}</h2>
          )}
          {activeTool === 'color' && (
            <span className="workspace-tool-panel-actions">
              {mask.editing ? (
                <Button className="workspace-mask-editor-done" variant="ghost" size="mini" onClick={() => { mask.setEditing(false); mask.setSemanticPicking(false) }}>完成</Button>
              ) : (
                <>
                  {toolModified.color && <span className="ui-accordion-modified-dot" />}
                  <Tooltip content="重置全部调色与蒙版">
                    <IconButton
                      variant="ghost"
                      size="compact"
                      icon={<RotateCcw size={14} />}
                      onClick={requestResetAllColor}
                      aria-label="重置全部调色与蒙版"
                    />
                  </Tooltip>
                </>
              )}
            </span>
          )}
          {activeTool === 'trim' && (
            <span className="workspace-tool-panel-actions">
              {toolModified.trim && <span className="ui-accordion-modified-dot" />}
              <Tooltip content="重置截取范围">
                <IconButton
                  variant="ghost"
                  size="compact"
                  icon={<RotateCcw size={14} />}
                  onClick={() => edit.commitPatch({ trim: null })}
                  aria-label="重置截取范围"
                />
              </Tooltip>
            </span>
          )}
        </header>
        <div className={`workspace-tool-panel-body${activeTool === 'color' ? ' is-color-panel' : ''}${activeTool === 'creative' ? ' is-creative-panel' : ''}${activeTool === 'subtitles' ? ' is-subtitle-panel' : ''}`}>
          {activeTool === 'creative' ? (
            <WorkspaceCreativePanel onSelect={onOpenCreative} />
          ) : activeTool === 'filter' ? (
            <FilterPanel
              restoreLut={restoreLut}
              restoreLutId={edit.pipeline.logRestore.activeId}
              onRestoreChange={(activeId) => edit.updateWorkspacePanel({ logRestore: { activeId } })}
              activeLutId={edit.pipeline.lutFilter.activeId}
              onChange={(lutId, intensity) => edit.updateWorkspacePanel({ lutFilter: {
                activeId: lutId,
                ...(intensity === undefined ? {} : { intensity }),
              } })}
              intensity={edit.pipeline.lutFilter.intensity}
              onIntensityChange={(intensity) => edit.updateWorkspacePanel({ lutFilter: { intensity } })}
              mediaPath={mediaCtx.activeMedia?.path}
              searchKey={filterSearchKey}
            />
          ) : activeTool === 'color' ? (
            <ColorMaskPanel />
          ) : activeTool === 'beauty' ? (
            <BeautyPanel duration={duration} />
          ) : activeTool === 'removal' ? (
            <RemovalPanel />
          ) : activeTool === 'subtitles' ? (
            <SubtitlePanel duration={duration} trim={edit.pipeline.trim} onSeek={onTrimSeek} />
          ) : activeTool === 'crop' ? (
            <>
              <Accordion
                title="裁剪"
                defaultOpen
                actions={
                  <button
                    className="workspace-acc-reset"
                    type="button"
                    onClick={() => edit.updateWorkspacePanel({ transform: createDefaultPipeline().transform })}
                    title="重置几何变换"
                  >
                    <RotateCcw size={11} />
                  </button>
                }
              >
                <TransformPanel
                  value={edit.activeTransform}
                  cropPreset={edit.cropPreset}
                  cropWidth={cropWidth}
                  cropHeight={cropHeight}
                  onChange={(transform) => edit.updateWorkspacePanel({ transform })}
                  onRotateChange={edit.handleRotateChange}
                  onCropPresetChange={onCropPresetChange}
                  onCropSizeChange={onCropSizeChange}
                />
                <WorkspaceAiCompositionPanel
                  filePath={mediaCtx.activeMedia?.path ?? null}
                  frameTime={mediaCtx.activeMedia?.kind === 'video' ? currentTime : undefined}
                  sourceAspect={canvas.sourceAspect}
                  orientation={edit.activeTransform.orientation}
                  rotate={edit.activeTransform.rotate}
                  aspectRatio={cropAspectRatio}
                  crop={edit.activeTransform.crop}
                  onApply={(crop) => edit.setTransformDraft((current) => ({
                    ...(current ?? edit.pipeline.transform),
                    crop,
                  }))}
                />
              </Accordion>
              <div className="workspace-crop-panel-actions">
                <Button variant="secondary" size="compact" icon={<X size={14} />} onClick={edit.cancelCrop}>
                  取消
                </Button>
                <Button variant="primary" size="compact" icon={<Check size={14} />} onClick={edit.confirmCrop}>
                  完成裁剪
                </Button>
              </div>
            </>
          ) : activeTool === 'trim' ? (
            <TrimPanel
              startTime={edit.pipeline.trim?.startTime ?? 0}
              endTime={edit.pipeline.trim?.endTime ?? duration}
              currentTime={currentTime}
              duration={duration}
              markers={edit.pipeline.outputMarkers}
              liveSelection={livePhotoSelection}
              onLiveSelectionChange={onLivePhotoSelectionChange}
              videoPath={mediaCtx.activeMedia?.path ?? null}
              activeMarkerId={activeMarkerId}
              onActiveMarkerChange={onActiveMarkerChange}
              playingMarkerId={playingMarkerId}
              onToggleMarkerPreview={onToggleMarkerPreview}
              onMarkerPreviewTimeChange={onTrimSeek}
              onStartTimeChange={(time) => {
                const end = edit.pipeline.trim?.endTime ?? duration
                edit.commitPatch({ trim: { startTime: time, endTime: Math.max(time + 0.1, end) } })
              }}
              onEndTimeChange={(time) => {
                const curStart = edit.pipeline.trim?.startTime ?? 0
                edit.commitPatch({ trim: { startTime: curStart, endTime: time } })
              }}
              onMarkersChange={(outputMarkers) => edit.commitPatch({ outputMarkers })}
              onSelectMarker={(marker) => {
                if (marker.kind === 'photo') {
                  onTrimSeek(marker.time)
                  return
                }
                if (marker.kind === 'live') {
                  onTrimSeek(marker.coverTime)
                  return
                }
                onTrimSeek(marker.startTime)
              }}
            />
          ) : activeTool === 'border' ? (
            <BorderPanel
              value={edit.pipeline.border}
              onChange={(border) => edit.updateWorkspacePanel({ border })}
              mediaPath={mediaCtx.activeMedia?.path}
              defaultTitle={defaultBorderTitle}
            />
          ) : (
            <Accordion
              title="水印"
              defaultOpen
            >
              <WatermarkSettings
                settings={edit.pipeline.watermark}
                onChange={handleWatermarkChange}
                filePath={mediaCtx.activeMedia?.path}
                mediaKind={mediaCtx.activeMedia?.kind}
                deviceMetadata={mediaCtx.activeMedia}
              />
            </Accordion>
          )}
        </div>
      </section>
      <nav className="workspace-tool-rail" aria-label="工作台工具">
        <div className="workspace-tool-rail-main">
          {visibleToolItems.map((item) => {
            const resourceLoading = item.value === 'filter'
              ? runtimeResourceLoading?.luts === true
              : item.value === 'border' && runtimeResourceLoading?.fonts === true
            return (
            <div key={item.value} className="workspace-tool-rail-item">
              <Tooltip side="left" content={resourceLoading ? `${item.label}资源加载中` : item.label}>
                <IconButton
                  variant={activeTool === item.value ? 'outline' : 'ghost'}
                  size="compact"
                  icon={resourceLoading ? <Loader2 className="spin" size={20} /> : item.icon}
                  aria-label={item.label}
                  disabled={resourceLoading || (item.value === 'mask' && !mask.available) || ((item.value === 'beauty' || item.value === 'removal') && mediaCtx.activeMedia?.kind !== 'image') || ((item.value === 'trim' || item.value === 'subtitles') && mediaCtx.activeMedia?.kind !== 'video')}
                  onClick={() => {
                    mask.setEditing(item.value === 'mask')
                    edit.selectTool(item.value, canvas.sourceAspect, mediaSize ?? undefined)
                  }}
                />
              </Tooltip>
              {toolModified[item.value] && <span className="workspace-tool-rail-dot" />}
            </div>
            )
          })}
        </div>
      </nav>
      <Dialog
        open={resetColorDialogOpen}
        onOpenChange={setResetColorDialogOpen}
        title="重置全部调色？"
        description="所有全局调色设置和蒙版都会被清除，此操作可以撤销。"
        tone="dark"
        footer={(
          <>
            <Button variant="secondary" size="compact" onClick={() => setResetColorDialogOpen(false)}>取消</Button>
            <Button variant="danger" size="compact" icon={<RotateCcw size={14} />} onClick={resetAllColor}>全部重置</Button>
          </>
        )}
      />
    </aside>
  )
}
