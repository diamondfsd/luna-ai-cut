import { Check, Crop, ImagePlus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'

import { Accordion, Button, IconButton, Tooltip } from '../../ui'
import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { createDefaultPipeline, DEFAULT_PIPELINE } from '../shared/editPipeline'
import { ColorPanel } from '../color/ColorPanel'
import { TransformPanel, type CropPreset } from '../transform/TransformPanel'
import { WatermarkSettings } from '../../components/WatermarkSettings'

export type WorkspaceTool = 'color' | 'crop' | 'watermark'

interface WorkspaceEditSidebarProps {
  activeTool: WorkspaceTool
  pipeline: EditPipeline
  cropPreset: CropPreset
  cropWidth: number
  cropHeight: number
  onSelectTool: (tool: WorkspaceTool) => void
  onUpdatePipeline: (patch: PipelinePatch) => void
  onRotateChange: (rotate: number) => void
  onCropPresetChange: (preset: CropPreset) => void
  onCropSizeChange: (size: { width?: number; height?: number }) => void
  onCancelCrop: () => void
  onConfirmCrop: () => void
  onActivatePipette: () => void
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

/** 检查当前 pipeline 的调色参数是否有任何修改 */
function isColorModified(color: EditPipeline['color']): boolean {
  const d = DEFAULT_PIPELINE.color
  return (
    color.exposure !== d.exposure ||
    color.black !== d.black ||
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
    color.curveLift !== d.curveLift ||
    color.curveContrast !== d.curveContrast ||
    color.levelsBlack !== d.levelsBlack ||
    color.levelsGray !== d.levelsGray ||
    color.levelsWhite !== d.levelsWhite ||
    color.hslSat !== d.hslSat ||
    color.hslLum !== d.hslLum ||
    color.clarity !== d.clarity ||
    color.texture !== d.texture ||
    color.sharpen !== d.sharpen ||
    color.denoise !== d.denoise ||
    Object.values(color.curve.points).some((points) => points.length > 0)
  )
}

export function WorkspaceEditSidebar({
  activeTool,
  pipeline,
  cropPreset,
  cropWidth,
  cropHeight,
  onSelectTool,
  onUpdatePipeline,
  onRotateChange,
  onCropPresetChange,
  onCropSizeChange,
  onCancelCrop,
  onConfirmCrop,
  onActivatePipette,
}: WorkspaceEditSidebarProps) {
  return (
    <aside className="workspace-edit-sidebar">
      <section className="workspace-tool-panel">
        <header className="workspace-tool-panel-header">
          <h2>{titleForTool(activeTool)}</h2>
          {activeTool === 'color' && (
            <span className="workspace-tool-panel-actions">
              {isColorModified(pipeline.color) && <span className="ui-accordion-modified-dot" />}
              <Tooltip content="重置全部调色">
                <IconButton
                  variant="ghost"
                  size="compact"
                  icon={<RotateCcw size={14} />}
                  onClick={() => onUpdatePipeline({ color: DEFAULT_PIPELINE.color, effects: DEFAULT_PIPELINE.effects })}
                  aria-label="重置全部调色"
                />
              </Tooltip>
            </span>
          )}
        </header>
        <div className="workspace-tool-panel-body">
          {activeTool === 'color' ? (
            <ColorPanel
              value={pipeline.color}
              onChange={(color) => onUpdatePipeline({ color })}
              onActivatePipette={onActivatePipette}
            />
          ) : activeTool === 'crop' ? (
            <>
              <Accordion
                title="裁剪"
                defaultOpen
                actions={
                  <button
                    className="workspace-acc-reset"
                    type="button"
                    onClick={() => onUpdatePipeline({ transform: createDefaultPipeline().transform })}
                    title="重置几何变换"
                  >
                    <RotateCcw size={11} />
                  </button>
                }
              >
                <TransformPanel
                  value={pipeline.transform}
                  cropPreset={cropPreset}
                  cropWidth={cropWidth}
                  cropHeight={cropHeight}
                  onChange={(transform) => onUpdatePipeline({ transform })}
                  onRotateChange={onRotateChange}
                  onCropPresetChange={onCropPresetChange}
                  onCropSizeChange={onCropSizeChange}
                />
              </Accordion>
              <div className="workspace-crop-panel-actions">
                <Button variant="secondary" size="compact" icon={<X size={14} />} onClick={onCancelCrop}>
                  取消
                </Button>
                <Button variant="primary" size="compact" icon={<Check size={14} />} onClick={onConfirmCrop}>
                  完成裁剪
                </Button>
              </div>
            </>
          ) : (
            <Accordion
              title="水印"
              defaultOpen
              actions={
                <button
                  className="workspace-acc-reset"
                  type="button"
                  onClick={() => onUpdatePipeline({ watermark: createDefaultPipeline().watermark })}
                  title="重置水印"
                >
                  <RotateCcw size={11} />
                </button>
              }
            >
              <WatermarkSettings
                settings={pipeline.watermark}
                onChange={(watermark) => onUpdatePipeline({ watermark })}
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
                variant={activeTool === item.value ? 'outline' : 'ghost'}
                size="compact"
                icon={item.icon}
                aria-label={item.label}
                onClick={() => onSelectTool(item.value)}
              />
            </Tooltip>
          ))}
        </div>
      </nav>
    </aside>
  )
}
