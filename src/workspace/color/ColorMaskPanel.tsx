import { Copy, Eye, EyeOff, MoreHorizontal, Pencil, Plus, RefreshCcw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button, Dialog, IconButton, Input, Popover, PopoverClose, PopoverContent, PopoverTrigger, Tooltip } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { MaskPanel } from '../mask/MaskPanel'
import { ColorPanel } from './ColorPanel'
import './ColorMaskPanel.css'

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
      const size = 48
      const pixels = new Uint8ClampedArray(size * size * 4)
      const source = new Uint8Array(mask.bytes)
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const sourceX = Math.min(mask.width - 1, Math.floor(x / size * mask.width))
          const sourceY = Math.min(mask.height - 1, Math.floor(y / size * mask.height))
          const selected = source[sourceY * mask.width + sourceX]
          const value = inverted ? selected : 255 - selected
          const offset = (y * size + x) * 4
          pixels[offset] = value
          pixels[offset + 1] = value
          pixels[offset + 2] = value
          pixels[offset + 3] = 255
        }
      }
      context.putImageData(new ImageData(pixels, size, size), 0, 0)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [inverted, path, projectId])

  return <canvas ref={canvasRef} className="workspace-color-mask-thumbnail" width={48} height={48} aria-label="蒙版缩略图" />
}

export function ColorMaskPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const selectedColor = mask.activeMask?.color ?? edit.pipeline.color

  const closeEditor = () => {
    mask.setEditing(false)
    mask.setSemanticPicking(false)
  }

  return (
    <div className="workspace-color-mask-panel">
      <div className="workspace-color-mask-current">
        <span>{mask.activeMask ? `正在调整：${mask.activeMask.name}` : '正在调整：全局'}</span>
      </div>
      <ColorPanel
        value={selectedColor}
        onChange={(color) => mask.activeMask
          ? mask.updateActiveLayer({ color: { ...mask.activeMask.color, ...color } })
          : edit.updateWorkspacePanel({ color })}
        onActivatePipette={mask.activeMask ? undefined : () => edit.setPipetteActive(true)}
      />

      <section className="workspace-color-mask-layers" aria-label="蒙版图层">
        <div className="workspace-color-mask-layers-header">
          <div>
            <strong>蒙版图层</strong>
            <span>点击图层切换局部调色</span>
          </div>
          <Button variant="secondary" size="mini" icon={<Plus size={13} />} disabled={!mask.available} onClick={mask.createMask}>
            新建
          </Button>
        </div>
        <div className="workspace-color-mask-layer-list">
          <div className={`workspace-color-mask-layer${!mask.activeMask ? ' is-active' : ''}`}>
            <Button
              variant="ghost"
              size="compact"
              className="workspace-color-mask-layer-select"
              onClick={() => mask.setActiveLayerId(null)}
            >
              <span className="workspace-color-mask-global-thumbnail"><SlidersHorizontal size={18} /></span>
              <span className="workspace-color-mask-layer-label"><strong>全局调色</strong><small>整张画面</small></span>
            </Button>
          </div>
          {edit.pipeline.colorMasks.map((layer, index) => {
            const active = mask.activeLayerId === layer.id
            return (
              <div className={`workspace-color-mask-layer${active ? ' is-active' : ''}`} key={layer.id}>
                <Button variant="ghost" size="compact" className="workspace-color-mask-layer-select" onClick={() => mask.setActiveLayerId(layer.id)}>
                  <MaskThumbnail path={layer.path} inverted={layer.inverted} />
                  <span className="workspace-color-mask-layer-label"><strong>{layer.name}</strong><small>{layer.kind === 'semantic' ? layer.className ?? '智能蒙版' : '画笔蒙版'}</small></span>
                </Button>
                <span className="workspace-color-mask-layer-actions">
                  <Tooltip content="编辑蒙版">
                    <IconButton variant="ghost" size="mini" icon={<Pencil size={14} />} aria-label="编辑蒙版" onClick={() => { mask.setActiveLayerId(layer.id); mask.setEditing(true) }} />
                  </Tooltip>
                  <Tooltip content={layer.enabled ? '隐藏这一层' : '显示这一层'}>
                    <IconButton variant="ghost" size="mini" icon={layer.enabled ? <Eye size={14} /> : <EyeOff size={14} />} aria-label={layer.enabled ? '隐藏这一层' : '显示这一层'} onClick={() => mask.updateLayer(layer.id, { enabled: !layer.enabled })} />
                  </Tooltip>
                  <Popover>
                    <PopoverTrigger asChild>
                      <IconButton variant="ghost" size="mini" icon={<MoreHorizontal size={15} />} aria-label="更多图层操作" />
                    </PopoverTrigger>
                    <PopoverContent className="workspace-color-mask-layer-menu" align="end">
                      <PopoverClose asChild><Button variant="ghost" size="mini" icon={<Copy size={13} />} onClick={() => mask.duplicateLayer(layer.id)}>复制图层</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="ghost" size="mini" icon={<RefreshCcw size={13} />} onClick={() => mask.updateLayer(layer.id, { inverted: !layer.inverted })}>反向蒙版</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="ghost" size="mini" disabled={index === 0} onClick={() => mask.moveLayer(layer.id, -1)}>上移一层</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="ghost" size="mini" disabled={index === edit.pipeline.colorMasks.length - 1} onClick={() => mask.moveLayer(layer.id, 1)}>下移一层</Button></PopoverClose>
                      <PopoverClose asChild><Button variant="danger" size="mini" icon={<Trash2 size={13} />} onClick={() => mask.removeLayer(layer.id)}>删除图层</Button></PopoverClose>
                    </PopoverContent>
                  </Popover>
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <Dialog
        open={mask.editing}
        onOpenChange={(open) => open ? mask.setEditing(true) : closeEditor()}
        title={mask.activeMask ? `编辑“${mask.activeMask.name}”` : '新建蒙版'}
        description="使用智能选择或画笔调整蒙版范围；列表缩略图中的黑色区域为当前选区。"
        className="workspace-mask-editor-dialog"
        modal={false}
        showOverlay={false}
        closeOnMaskClick={false}
        footer={<Button variant="primary" onClick={closeEditor}>完成</Button>}
      >
        <div className="workspace-mask-editor-body">
          {mask.activeMask && (
            <Input variant="compact" fullWidth aria-label="蒙版名称" value={mask.activeMask.name} onChange={(event) => mask.updateActiveLayer({ name: event.target.value })} />
          )}
          <MaskPanel />
        </div>
      </Dialog>
    </div>
  )
}
