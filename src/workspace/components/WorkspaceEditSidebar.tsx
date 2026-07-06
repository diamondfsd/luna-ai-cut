import { Check, Crop, ImagePlus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useMemo } from 'react'

import { Accordion, Button, IconButton, Tooltip } from '../../ui'
import { createDefaultPipeline, DEFAULT_PIPELINE } from '../shared/editPipeline'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { ColorPanel } from '../color/ColorPanel'
import { TransformPanel, type CropPreset } from '../transform/TransformPanel'
import { WatermarkSettings } from '../../components/WatermarkSettings'
import type { PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../../shared/types'
import type { EditPipeline } from '../shared/editPipeline'

export type WorkspaceTool = 'color' | 'crop' | 'watermark'

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
    Object.values(color.hslChannels).some((channel) => channel.hueShift !== 0 || channel.saturation !== 0 || channel.luminance !== 0) ||
    color.clarity !== d.clarity ||
    color.texture !== d.texture ||
    color.sharpen !== d.sharpen ||
    color.denoise !== d.denoise ||
    Object.values(color.curve.points).some((points) => points.length > 0)
  )
}

const TOOL_ITEMS: Array<{ value: WorkspaceTool; label: string; icon: JSX.Element }> = [
  { value: 'color', label: '色彩调节', icon: <SlidersHorizontal size={22} /> },
  { value: 'crop', label: '裁剪工具', icon: <Crop size={24} /> },
  { value: 'watermark', label: '水印', icon: <ImagePlus size={22} /> },
]

function titleForTool(tool: WorkspaceTool): string {
  if (tool === 'crop') return '裁剪工具'
  if (tool === 'watermark') return '水印'
  return '色彩调节'
}

interface WorkspaceEditSidebarProps {
  mediaSize?: { w: number; h: number } | null
}

export function WorkspaceEditSidebar({ mediaSize }: WorkspaceEditSidebarProps) {
  const edit = useWorkspaceEdit()
  const canvas = useWorkspaceCanvas()
  const mediaCtx = useWorkspaceMedia()

  const refH = mediaSize?.h ?? 2160
  const cropWidth = edit.cropSize.width || Math.round(canvas.sourceAspect * refH)
  const cropHeight = edit.cropSize.height || refH

  // 保存水印设置到 pipeline（同时产生预览层和撤销记录）
  const handleWatermarkChange = useMemo(
    () => (watermarkSettings: WatermarkSettingsType, _layer?: PreviewLayer) => {
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

  // 水印检测由 WatermarkSettings 内部根据 filePath 自动完成

  return (
    <aside className="workspace-edit-sidebar">
      <section className="workspace-tool-panel">
        <header className="workspace-tool-panel-header">
          <h2>{titleForTool(edit.activeTool)}</h2>
          {edit.activeTool === 'color' && (
            <span className="workspace-tool-panel-actions">
              {isColorModified(edit.pipeline.color) && <span className="ui-accordion-modified-dot" />}
              <Tooltip content="重置全部调色">
                <IconButton
                  variant="ghost"
                  size="compact"
                  icon={<RotateCcw size={14} />}
                  onClick={() => edit.updateWorkspacePanel({ color: DEFAULT_PIPELINE.color, effects: DEFAULT_PIPELINE.effects })}
                  aria-label="重置全部调色"
                />
              </Tooltip>
            </span>
          )}
        </header>
        <div className="workspace-tool-panel-body">
          {edit.activeTool === 'color' ? (
            <ColorPanel
              value={edit.pipeline.color}
              onChange={(color) => edit.updateWorkspacePanel({ color })}
              onActivatePipette={() => edit.setPipetteActive(true)}
            />
          ) : edit.activeTool === 'crop' ? (
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
          ) : (
            <Accordion
              title="水印"
              defaultOpen
            >
              <WatermarkSettings
                settings={edit.pipeline.watermark}
                onChange={handleWatermarkChange}
                filePath={mediaCtx.activeMedia?.path}
              />
            </Accordion>
          )}
        </div>
      </section>
      <nav className="workspace-tool-rail" aria-label="工作台工具">
        <div className="workspace-tool-rail-main">
          {TOOL_ITEMS.map((item) => (
            <Tooltip key={item.value} content={item.label}>
              <IconButton
                variant={edit.activeTool === item.value ? 'outline' : 'ghost'}
                size="compact"
                icon={item.icon}
                aria-label={item.label}
                onClick={() => edit.selectTool(item.value, canvas.sourceAspect, mediaSize ?? undefined)}
              />
            </Tooltip>
          ))}
        </div>
      </nav>
    </aside>
  )
}
