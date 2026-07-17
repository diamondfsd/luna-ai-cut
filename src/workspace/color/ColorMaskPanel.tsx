import { AlertTriangle, ArrowDown, ArrowUp, Copy, Eye, EyeOff, Globe2, GripVertical, MoreHorizontal, Pencil, Plus, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, Dialog, IconButton, Input, Popover, PopoverClose, PopoverContent, PopoverTrigger, Select, Tooltip } from '../../ui'
import { createDefaultPipeline, type ColorMaskBlendMode, type ColorMaskLayer } from '../shared/editPipeline'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { MaskPanel } from '../mask/MaskPanel'
import { featherMaskPreview, sampleMaskBilinear } from '../mask/maskPreviewSampling'
import { ColorPanel } from './ColorPanel'
import { normalizeColorMaskName, reorderColorMaskLayers, type ColorMaskDropPosition } from './colorMaskLayerOperations'
import './ColorMaskPanel.css'

const THUMBNAIL_WIDTH = 68
const THUMBNAIL_HEIGHT = 42
const BLEND_MODE_OPTIONS = [
  { value: 'normal', label: '正常' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'add', label: '线性减淡' },
]
const BLEND_MODE_DESCRIPTIONS: Record<ColorMaskBlendMode, string> = {
  normal: '自然叠加局部调整',
  multiply: '加深选中的区域',
  screen: '柔和提亮选中的区域',
  add: '更强地提亮选中的区域',
}

function MaskThumbnail({ path, inverted, feather }: { path: string; inverted: boolean; feather: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const media = useWorkspaceMedia()
  const projectId = media.currentProject?.id
  const [sourceMask, setSourceMask] = useState<{ width: number; height: number; data: Uint8Array } | null>(null)

  useEffect(() => {
    setSourceMask(null)
    if (!projectId) return
    let cancelled = false
    window.luna.workspace.loadColorMask(projectId, path).then((mask) => {
      if (cancelled) return
      setSourceMask({ width: mask.width, height: mask.height, data: new Uint8Array(mask.bytes) })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [path, projectId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#fff'
    context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
    if (!sourceMask) return

      const scale = Math.min(THUMBNAIL_WIDTH / sourceMask.width, THUMBNAIL_HEIGHT / sourceMask.height)
      const width = Math.max(1, Math.round(sourceMask.width * scale))
      const height = Math.max(1, Math.round(sourceMask.height * scale))
      const offsetX = Math.floor((THUMBNAIL_WIDTH - width) / 2)
      const offsetY = Math.floor((THUMBNAIL_HEIGHT - height) / 2)
      const pixels = new Uint8ClampedArray(width * height * 4)
      const previewMask = new Float32Array(width * height)
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          previewMask[y * width + x] = sampleMaskBilinear(
            sourceMask.data,
            sourceMask.width,
            sourceMask.height,
            (x + 0.5) / width,
            (y + 0.5) / height,
          )
        }
      }
      const feathered = featherMaskPreview(
        previewMask,
        width,
        height,
        feather,
        sourceMask.width / width,
        sourceMask.height / height,
      )
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const selected = feathered[y * width + x]
          const value = inverted ? selected : 255 - selected
          const offset = (y * width + x) * 4
          pixels[offset] = value
          pixels[offset + 1] = value
          pixels[offset + 2] = value
          pixels[offset + 3] = 255
        }
      }
      context.putImageData(new ImageData(pixels, width, height), offsetX, offsetY)
  }, [feather, inverted, sourceMask])

  return <canvas ref={canvasRef} className="workspace-color-mask-thumbnail" width={THUMBNAIL_WIDTH} height={THUMBNAIL_HEIGHT} aria-label="蒙版缩略图" />
}

export function ColorMaskPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const media = useWorkspaceMedia()
  const selectedColor = mask.activeMask?.color ?? edit.pipeline.color
  const isVideo = media.activeMedia?.kind === 'video'
  const createMaskHint = isVideo
    ? '当前版本仅支持图片'
    : mask.available ? '新建蒙版' : '请先在项目中打开一张图片'
  const [renameState, setRenameState] = useState<{ id: string; originalName: string; value: string } | null>(null)
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; position: ColorMaskDropPosition } | null>(null)

  const openRename = (layer: ColorMaskLayer): void => {
    setRenameState({ id: layer.id, originalName: layer.name, value: layer.name })
  }

  const confirmRename = (): void => {
    if (!renameState) return
    const name = normalizeColorMaskName(renameState.value, renameState.originalName)
    if (name !== renameState.originalName) mask.updateLayer(renameState.id, { name })
    setRenameState(null)
  }

  const clearDragState = (): void => {
    setDraggedLayerId(null)
    setDropTarget(null)
  }

  const dropLayer = (targetId: string, position: ColorMaskDropPosition): void => {
    if (!draggedLayerId) return
    const next = reorderColorMaskLayers(edit.pipeline.colorMasks, draggedLayerId, targetId, position)
    if (next !== edit.pipeline.colorMasks) edit.commitPatch({ colorMasks: next })
    clearDragState()
  }

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
          <span className="workspace-color-mask-layers-header-actions">
            {isVideo && <small>当前版本仅支持图片</small>}
            <Tooltip content={createMaskHint}>
              <span className="workspace-color-mask-create-trigger">
                <IconButton variant="ghost" size="mini" icon={<Plus size={18} />} aria-label={createMaskHint} disabled={!mask.available} onClick={mask.createMask} />
              </span>
            </Tooltip>
          </span>
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
          {edit.pipeline.colorMasks.map((layer, index) => {
            const active = mask.activeLayerId === layer.id
            const targetPosition = dropTarget?.id === layer.id ? dropTarget.position : null
            return (
              <div
                className={`workspace-color-mask-layer${active ? ' is-active' : ''}${layer.loadError ? ' is-unavailable' : ''}${draggedLayerId === layer.id ? ' is-dragging' : ''}${targetPosition ? ` is-drop-${targetPosition}` : ''}`}
                key={layer.id}
                onDragOver={(event) => {
                  if (!draggedLayerId || draggedLayerId === layer.id) return
                  event.preventDefault()
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                  if (dropTarget?.id !== layer.id || dropTarget.position !== position) setDropTarget({ id: layer.id, position })
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                  dropLayer(layer.id, position)
                }}
              >
                <Tooltip content={`拖动${layer.name}调整顺序`}>
                  <IconButton
                    variant="ghost"
                    size="mini"
                    className="workspace-color-mask-drag-handle"
                    icon={<GripVertical size={15} />}
                    aria-label={`拖动${layer.name}调整顺序`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', layer.id)
                      setDraggedLayerId(layer.id)
                    }}
                    onDragEnd={clearDragState}
                  />
                </Tooltip>
                <Tooltip content={layer.loadError ? '蒙版文件不可用' : layer.enabled ? '隐藏这一层' : '显示这一层'}>
                  <IconButton
                    variant="ghost"
                    size="mini"
                    className="workspace-color-mask-layer-eye-button"
                    icon={layer.enabled ? <Eye size={17} /> : <EyeOff size={17} />}
                    aria-label={layer.loadError ? '蒙版文件不可用，无法切换显示' : layer.enabled ? '隐藏这一层' : '显示这一层'}
                    disabled={Boolean(layer.loadError)}
                    onClick={() => mask.updateLayer(layer.id, { enabled: !layer.enabled })}
                  />
                </Tooltip>
                <Button variant="ghost" size="compact" className="workspace-color-mask-layer-select" onClick={() => mask.setActiveLayerId(layer.id)}>
                  <MaskThumbnail path={layer.path} inverted={layer.inverted} feather={layer.feather} />
                  <span className="workspace-color-mask-layer-label">
                    <strong onDoubleClick={(event) => { event.stopPropagation(); openRename(layer) }}>{layer.name}</strong>
                    {layer.loadError && <small className="workspace-color-mask-layer-status"><AlertTriangle size={12} />文件不可用，可重新编辑</small>}
                  </span>
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
                      <small className="workspace-color-mask-blend-description">{BLEND_MODE_DESCRIPTIONS[layer.blendMode]}</small>
                      <PopoverClose asChild><Button variant="ghost" size="compact" icon={<Pencil size={14} />} onClick={() => openRename(layer)}>重命名</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="ghost" size="compact" icon={<ArrowUp size={14} />} disabled={index === 0} onClick={() => mask.moveLayer(layer.id, -1)}>上移</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="ghost" size="compact" icon={<ArrowDown size={14} />} disabled={index === edit.pipeline.colorMasks.length - 1} onClick={() => mask.moveLayer(layer.id, 1)}>下移</Button></PopoverClose>
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
      <Dialog
        open={Boolean(renameState)}
        onOpenChange={(open) => { if (!open) setRenameState(null) }}
        title="重命名蒙版"
        description="名称最多 40 个字符"
        tone="dark"
        className="workspace-color-mask-rename-dialog"
        footer={(
          <>
            <Button variant="secondary" size="compact" onClick={() => setRenameState(null)}>取消</Button>
            <Button variant="primary" size="compact" onClick={confirmRename}>确认</Button>
          </>
        )}
      >
        <form className="workspace-color-mask-rename-form" onSubmit={(event) => { event.preventDefault(); confirmRename() }}>
          <Input
            variant="compact"
            fullWidth
            autoFocus
            maxLength={40}
            aria-label="蒙版名称"
            value={renameState?.value ?? ''}
            onChange={(event) => setRenameState((current) => current ? { ...current, value: event.target.value } : null)}
          />
        </form>
      </Dialog>
    </div>
  )
}
