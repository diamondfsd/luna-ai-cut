import { ThumbImage } from '../components/ThumbImage'
import type { AiFaceGroup, AiSelectionItem } from '../shared/types'

export function AiFaceGroupCover({ group, item }: { group: AiFaceGroup; item: AiSelectionItem | undefined }) {
  const source = group.coverUrl ?? item?.thumbnailUrl ?? item?.path
  if (!source) return <span className="ai-selection-face-group-cover" />
  const bounds = group.coverBounds
  return <span className="ai-selection-face-group-cover"><ThumbImage
    src={source}
    alt=""
    style={{
      width: `${100 / bounds.width}%`,
      height: `${100 / bounds.height}%`,
      left: `${-bounds.x / bounds.width * 100}%`,
      top: `${-bounds.y / bounds.height * 100}%`,
    }}
  /></span>
}

export function AiCoPhotoGroupCover({ item }: { item: AiSelectionItem | undefined }) {
  const source = item?.thumbnailUrl ?? item?.path
  if (!source) return <span className="ai-selection-face-group-cover ai-selection-co-photo-cover" />
  return <span className="ai-selection-face-group-cover ai-selection-co-photo-cover"><ThumbImage src={source} alt="" /></span>
}
