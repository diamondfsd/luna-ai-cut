import type { DirectorLanTake } from '../shared/types'
import { Plus, Trash2, Camera } from 'lucide-react'
import { Button, IconButton } from '../ui'
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

export function DirectorTakeList({ takes, selectedId, disabled, onSelect, onAddMaterials, onDelete }: Props) {
  const availableTakes = takes.filter(take => take.available && take.stream_url)
  return <aside className="director-take-list" aria-label="镜头素材列表">
    <div className="director-take-list-heading">
      <span className="director-take-list-count">素材 · {availableTakes.length}</span>
      <IconButton variant="ghost" size="compact" icon={<Plus size={18} />} aria-label="添加素材"
        title="添加素材" disabled={disabled} onClick={onAddMaterials} />
    </div>
    <div className="director-take-grid">
      {availableTakes.map((take, index) => <div key={take.id} className="director-take-card">
        <Button variant="utility" className="director-take-list-item" aria-pressed={take.id === selectedId}
          aria-label={`预览素材 ${index + 1}`} title={take.file_name} disabled={disabled} onClick={() => onSelect(take)}>
          {take.stream_url ? <DirectorMediaThumbnail url={take.stream_url} /> : <Camera size={20} />}
        </Button>
        {onDelete && take.stream_url?.startsWith('file:') && <IconButton variant="light" size="mini"
          className="director-take-delete" icon={<Trash2 size={14} />} aria-label={`删除素材 ${index + 1}`}
          disabled={disabled} onClick={() => onDelete(take)} />}
      </div>)}
    </div>
  </aside>
}
