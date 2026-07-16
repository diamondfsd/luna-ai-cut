import { Copy, Eye, EyeOff, Globe2, MoreHorizontal, Pencil, Plus, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button, IconButton, Popover, PopoverClose, PopoverContent, PopoverTrigger, Select, Tooltip } from '../../ui'
import { createDefaultPipeline, type ColorMaskBlendMode } from '../shared/editPipeline'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { MaskPanel } from '../mask/MaskPanel'
import { ColorPanel } from './ColorPanel'
import './ColorMaskPanel.css'

const THUMBNAIL_WIDTH = 68
const THUMBNAIL_HEIGHT = 42
const BLEND_MODE_OPTIONS = [
  { value: 'normal', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'add', label: '线性减淡' },
]

function MaskThumbnail({ path, inverted }: { path: string; inverted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const media = useWorkspaceMedia()
  const projectId = media.currentProject?.id

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !projectId) return
    let cancelled = false
    window.luna.workspace.loadColorMask(projectId, path).then((mask) => {
      if (cancelled) return
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = '#fff'
      context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)

      const scale = Math.min(THUMBNAIL_WIDTH / mask.width, THUMBNAIL_HEIGHT / mask.height)
      const width = Math.max(1, Math.round(mask.width * scale))
      const height = Math.max(1, Math.round(mask.height * scale))
      const offsetX = Math.floor((THUMBNAIL_WIDTH - width) / 2)
      const offsetY = Math.floor((THUMBNAIL_HEIGHT - height) / 2)
      const pixels = new Uint8ClampedArray(width * height * 4)
      const source = new Uint8Array(mask.bytes)
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const sourceX = Math.min(mask.width - 1, Math.floor(x / width * mask.width))
          const sourceY = Math.min(mask.height - 1, Math.floor(y / height * mask.height))
          const selected = source[sourceY * mask.width + sourceX]
          const value = inverted ? selected : 255 - selected
          const offset = (y * width + x) * 4
          pixels[offset] = value
          pixels[offset + 1] = value
          pixels[offset + 2] = value
          pixels[offset + 3] = 255
        }
      }
      context.putImageData(new ImageData(pixels, width, height), offsetX, offsetY)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [inverted, path, projectId])

  return <canvas ref={canvasRef} className="workspace-color-mask-thumbnail" width={THUMBNAIL_WIDTH} height={THUMBNAIL_HEIGHT} aria-label="蒙版缩略图" />
}

export function ColorMaskPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const selectedColor = mask.activeMask?.color ?? edit.pipeline.color

  return (
    <div className={`workspace-color-mask-panel${mask.editing ? ' is-editing' : ''}`}>
      <div className="workspace-color-mask-content">
        {mask.editing ? (
          <div className="workspace-mask-inline-editor"><MaskPanel /></div>
        ) : (
          <ColorPanel
            value={selectedColor}
            onChange={(color) => mask.activeMask
              ? mask.updateActiveLayer({ color: { ...mask.activeMask.color, ...color } })
              : edit.updateWorkspacePanel({ color })}
            onActivatePipette={mask.activeMask ? undefined : () => edit.setPipetteActive(true)}
          />
        )}
      </div>

      <section className="workspace-color-mask-layers" aria-label="蒙版图层">
        <div className="workspace-color-mask-layers-header">
          <strong>蒙版图层</strong>
          <Tooltip content="新建蒙版">
            <IconButton variant="ghost" size="mini" icon={<Plus size={18} />} aria-label="新建蒙版" disabled={!mask.available} onClick={mask.createMask} />
          </Tooltip>
        </div>
        <div className="workspace-color-mask-layer-list">
          <div className={`workspace-color-mask-layer workspace-color-mask-global-layer${!mask.activeMask ? ' is-active' : ''}`}>
            <Eye className="workspace-color-mask-layer-eye" size={17} aria-hidden="true" />
            <Globe2 className="workspace-color-mask-global-icon" size={18} aria-hidden="true" />
            <Button
              variant="ghost"
              size="compact"
              className="workspace-color-mask-layer-select"
              onClick={() => { mask.setActiveLayerId(null); mask.setEditing(false) }}
            >
              <span className="workspace-color-mask-global-thumbnail" />
              <span className="workspace-color-mask-layer-label"><strong>全局调色</strong></span>
            </Button>
            <Tooltip content="重置全局调色">
              <IconButton
                variant="ghost"
                size="mini"
                icon={<RotateCcw size={14} />}
                aria-label="重置全局调色"
                onClick={() => edit.updateWorkspacePanel({ color: createDefaultPipeline().color, effects: createDefaultPipeline().effects })}
              />
            </Tooltip>
          </div>
          {edit.pipeline.colorMasks.map((layer) => {
            const active = mask.activeLayerId === layer.id
            return (
              <div className={`workspace-color-mask-layer${active ? ' is-active' : ''}`} key={layer.id}>
                <Tooltip content={layer.enabled ? '隐藏这一层' : '显示这一层'}>
                  <IconButton
                    variant="ghost"
                    size="mini"
                    className="workspace-color-mask-layer-eye-button"
                    icon={layer.enabled ? <Eye size={17} /> : <EyeOff size={17} />}
                    aria-label={layer.enabled ? '隐藏这一层' : '显示这一层'}
                    onClick={() => mask.updateLayer(layer.id, { enabled: !layer.enabled })}
                  />
                </Tooltip>
                <Button variant="ghost" size="compact" className="workspace-color-mask-layer-select" onClick={() => mask.setActiveLayerId(layer.id)}>
                  <MaskThumbnail path={layer.path} inverted={layer.inverted} />
                  <span className="workspace-color-mask-layer-label"><strong>{layer.name}</strong></span>
                </Button>
                <span className="workspace-color-mask-layer-actions">
                  <Tooltip content="重置这一层的调色和混合模式">
                    <IconButton
                      variant="ghost"
                      size="mini"
                      icon={<RotateCcw size={14} />}
                      aria-label={`重置${layer.name}的调色和混合模式`}
                      onClick={() => mask.updateLayer(layer.id, {
                        color: createDefaultPipeline().color,
                        blendMode: 'normal',
                      })}
                    />
                  </Tooltip>
                  {!mask.editing && (
                    <Tooltip content="编辑蒙版">
                      <IconButton variant="ghost" size="mini" icon={<Pencil size={14} />} aria-label="编辑蒙版" onClick={() => { mask.setActiveLayerId(layer.id); mask.setEditing(true) }} />
                    </Tooltip>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <IconButton variant="ghost" size="mini" icon={<MoreHorizontal size={17} />} aria-label="更多图层操作" />
                    </PopoverTrigger>
                    <PopoverContent className="workspace-color-mask-layer-menu" align="end">
                      <label className="workspace-color-mask-blend-field">
                        <span>混合模式</span>
                        <Select
                          variant="compact"
                          fullWidth
                          value={layer.blendMode}
                          options={BLEND_MODE_OPTIONS}
                          onValueChange={(blendMode) => mask.updateLayer(layer.id, { blendMode: blendMode as ColorMaskBlendMode })}
                        />
                      </label>
                      <PopoverClose asChild><Button variant="ghost" size="compact" icon={<Copy size={14} />} onClick={() => mask.duplicateLayer(layer.id)}>复制图层</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="ghost" size="compact" icon={<RefreshCcw size={14} />} onClick={() => mask.updateLayer(layer.id, { inverted: !layer.inverted })}>反向蒙版</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="danger" size="compact" icon={<Trash2 size={14} />} onClick={() => mask.removeLayer(layer.id)}>删除图层</Button></PopoverClose>
                    </PopoverContent>
                  </Popover>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
