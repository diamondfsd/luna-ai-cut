import type { DirectorLanTake } from '../shared/types'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, IconButton, toast } from '../ui'
import { DirectorMediaThumbnail } from './DirectorMediaThumbnail'
import './DirectorTakeList.css'

interface Props {
  takes: DirectorLanTake[]
  selectedId: string
  disabled?: boolean
  onSelect: (take: DirectorLanTake) => void
  onAddMaterials: () => void
  onDelete?: (take: DirectorLanTake) => void
}

function videoPath(take: DirectorLanTake): string | null {
  const savedPath = take.stream_path?.trim() || take.download_path?.trim() || take.source_camera_path?.trim()
  if (savedPath) return savedPath
  if (take.stream_url?.startsWith('file:')) {
    try {
      const url = new URL(take.stream_url)
      let path = decodeURIComponent(url.pathname)
      if (url.hostname && url.hostname !== 'localhost') path = `//${url.hostname}${path}`
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
      return path || null
    } catch {
      return null
    }
  }
  return take.download_url ?? take.stream_url
}

function absoluteVideoPath(take: DirectorLanTake): string | null {
  if (take.stream_url?.startsWith('file:')) {
    try {
      const url = new URL(take.stream_url)
      let path = decodeURIComponent(url.pathname)
      if (url.hostname && url.hostname !== 'localhost') path = `//${url.hostname}${path}`
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1).replace(/\//g, '\\')
      return path || null
    } catch {
      return null
    }
  }
  const path = take.stream_path?.trim()
  return path && (/^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path)) ? path : null
}

export function DirectorTakeList({ takes, selectedId, disabled, onSelect, onAddMaterials, onDelete }: Props) {
  const availableTakes = takes.filter(take => take.available && take.stream_url)
  const copyVideoPath = async (take: DirectorLanTake) => {
    const path = videoPath(take)
    if (!path) return
    try {
      await window.luna.copyText(path)
      toast.success('已复制视频路径')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }
  const copySegmentDescription = async (take: DirectorLanTake) => {
    const path = absoluteVideoPath(take)
    if (!path) return
    const lines = [`片段绝对路径：${path}`]
    const note = take.selected_range?.note?.trim()
    if (note) lines.push(`片段备注：${note}`)
    try {
      await window.luna.copyText(lines.join('\n'))
      toast.success('已复制片段说明')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }
  return <aside className="director-take-list" aria-label="镜头素材列表">
    <div className="director-take-list-heading">
      <span className="director-take-list-count">素材 · {availableTakes.length}</span>
      <IconButton variant="ghost" size="compact" icon={<Plus size={18} />} aria-label="添加素材"
        title="添加素材" disabled={disabled} onClick={onAddMaterials} />
    </div>
    <div className="director-take-grid">
      {availableTakes.map((take, index) => <div key={take.id} className="director-take-card">
        {take.kind === 'video' ? <ContextMenu>
          <ContextMenuTrigger asChild>
            <Button variant="utility" className="director-take-list-item" aria-pressed={take.id === selectedId}
              aria-label={`预览素材 ${index + 1}`} title={take.file_name} disabled={disabled} onClick={() => onSelect(take)}>
              <DirectorMediaThumbnail url={take.stream_url!} />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={!videoPath(take)} onSelect={() => void copyVideoPath(take)}>
              <Copy size={14} />复制视频路径
            </ContextMenuItem>
            <ContextMenuItem disabled={!absoluteVideoPath(take)} onSelect={() => void copySegmentDescription(take)}>
              <Copy size={14} />复制片段说明
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu> : <Button variant="utility" className="director-take-list-item" aria-pressed={take.id === selectedId}
          aria-label={`预览素材 ${index + 1}`} title={take.file_name} disabled={disabled} onClick={() => onSelect(take)}>
          <DirectorMediaThumbnail url={take.stream_url!} />
        </Button>}
        {onDelete && take.stream_url?.startsWith('file:') && <IconButton variant="light" size="mini"
          className="director-take-delete" icon={<Trash2 size={14} />} aria-label={`删除素材 ${index + 1}`}
          disabled={disabled} onClick={() => onDelete(take)} />}
      </div>)}
    </div>
  </aside>
}
