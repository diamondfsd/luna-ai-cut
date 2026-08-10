import { useEffect, useState } from 'react'

import { ThumbImage } from '../components/ThumbImage'
import { FACE_AVATAR_CONTEXT_SCALE, squareCropAroundCenter } from '../shared/aiAvatarCrop'
import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import './AiPeopleGroupCover.css'

interface AiFaceGroupCoverProps {
  group: AiFaceGroup
  item: AiSelectionItem | undefined
  showFaceBounds?: boolean
}

export function AiFaceGroupCover({ group, item, showFaceBounds = false }: AiFaceGroupCoverProps) {
  const source = group.coverUrl ?? item?.thumbnailUrl ?? item?.path
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => { setImageSize(null) }, [source])

  if (!source) return <span className="ai-selection-face-group-cover" />
  const width = imageSize?.width ?? item?.width
  const height = imageSize?.height ?? item?.height
  const hasFaceBounds = group.coverBounds.width < 1 || group.coverBounds.height < 1
  const bounds = hasFaceBounds && width && height
    ? squareCropAroundCenter(group.coverBounds, width, height, FACE_AVATAR_CONTEXT_SCALE)
    : group.coverBounds
  const faceFrame = showFaceBounds && hasFaceBounds ? {
    left: `${(group.coverBounds.x - bounds.x) / bounds.width * 100}%`,
    top: `${(group.coverBounds.y - bounds.y) / bounds.height * 100}%`,
    width: `${group.coverBounds.width / bounds.width * 100}%`,
    height: `${group.coverBounds.height / bounds.height * 100}%`,
  } : null
  return <span className="ai-selection-face-group-cover"><ThumbImage
    src={source}
    alt=""
    onLoad={(event) => {
      if (event.currentTarget.src.startsWith('data:image/svg+xml')) return
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget
      if (width > 0 && height > 0) setImageSize((current) => current?.width === width && current.height === height ? current : { width, height })
    }}
    style={{
      width: `${100 / bounds.width}%`,
      height: `${100 / bounds.height}%`,
      left: `${-bounds.x / bounds.width * 100}%`,
      top: `${-bounds.y / bounds.height * 100}%`,
    }}
  />{faceFrame && <span className="ai-selection-face-group-frame" style={faceFrame} aria-hidden="true" />}</span>
}

export function AiCoPhotoGroupCover({ item }: { item: AiSelectionItem | undefined }) {
  const source = item?.thumbnailUrl ?? item?.path
  if (!source) return <span className="ai-selection-face-group-cover ai-selection-co-photo-cover" />
  return <span className="ai-selection-face-group-cover ai-selection-co-photo-cover"><ThumbImage src={source} alt="" /></span>
}
