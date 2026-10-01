import type { DirectorLanTake } from '../shared/types'
import { Button } from '../ui'
import { DirectorMediaThumbnail } from './DirectorMediaThumbnail'
import './DirectorTakeList.css'

interface Props {
  takes: DirectorLanTake[]
  selectedId: string
  disabled?: boolean
  onSelect: (take: DirectorLanTake) => void
}

export function DirectorTakeList({ takes, selectedId, disabled, onSelect }: Props) {
  return <aside className="director-take-list" aria-label="镜头素材列表">
    <span className="director-take-list-count">素材 · {takes.length}</span>
    {takes.map((take, index) => <Button key={take.id} variant="utility"
      className="director-take-list-item" aria-pressed={take.id === selectedId}
      disabled={disabled || !take.available || !take.stream_url} onClick={() => onSelect(take)}>
      {take.available && take.stream_url && <DirectorMediaThumbnail url={take.stream_url} />}
      <span className="director-take-list-info">
        <span>{index + 1}. {take.file_name || (take.kind === 'video' ? '视频' : '照片')}</span>
        <span>{!take.available || !take.stream_url ? '素材不可用' : take.stream_url.startsWith('file:') ? '本地' : '手机'}
          {take.duration_ms ? ` · ${(take.duration_ms / 1000).toFixed(1)} 秒` : ''}</span>
        {take.selected_range && <span>已标记 {(take.selected_range.start_ms / 1000).toFixed(1)}–{(take.selected_range.end_ms / 1000).toFixed(1)} 秒</span>}
        {take.selected_range?.note && <span>{take.selected_range.note}</span>}
      </span>
    </Button>)}
  </aside>
}
