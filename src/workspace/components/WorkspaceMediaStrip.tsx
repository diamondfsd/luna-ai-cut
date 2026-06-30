import type { WorkspaceMediaAsset } from '../../shared/types'

interface WorkspaceMediaStripProps {
  media: WorkspaceMediaAsset[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
}

export function WorkspaceMediaStrip({ media, activeIndex, onActiveIndexChange }: WorkspaceMediaStripProps) {
  return (
    <div className="workspace-media-strip">
      {media.map((item, index) => (
        <button
          key={item.id}
          className={`workspace-thumb${index === activeIndex ? ' active' : ''}`}
          type="button"
          onClick={() => onActiveIndexChange(index)}
        >
          <span className="workspace-thumb-preview">
            {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{item.kind === 'video' ? '视频' : '图片'}</span>}
          </span>
          <span className="workspace-thumb-name">{item.name}</span>
        </button>
      ))}
    </div>
  )
}
