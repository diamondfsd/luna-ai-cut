import { useEffect, useState } from 'react'

import { ThumbImage } from '../components/ThumbImage'
import { FACE_AVATAR_CONTEXT_SCALE, squareCropAroundCenter } from '../shared/aiAvatarCrop'
import type { AiFaceGroup, AiSelectionItem } from '../shared/types'

export function AiFaceGroupCover({ group, item }: { group: AiFaceGroup; item: AiSelectionItem | undefined }) {
  const source = group.coverUrl ?? item?.thumbnailUrl ?? item?.path
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => { setImageSize(null) }, [source])

  if (!source) return <span className="ai-selection-face-group-cover" />
  const isOriginalMedia = source === item?.thumbnailUrl || source === item?.path
  const width = imageSize?.width ?? item?.width
  const height = imageSize?.height ?? item?.height
  const bounds = isOriginalMedia && width && height
    ? squareCropAroundCenter(group.coverBounds, width, height, FACE_AVATAR_CONTEXT_SCALE)
    : group.coverBounds
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
  /></span>
}

export function AiCoPhotoGroupCover({ item }: { item: AiSelectionItem | undefined }) {
  const source = item?.thumbnailUrl ?? item?.path
  if (!source) return <span className="ai-selection-face-group-cover ai-selection-co-photo-cover" />
  return <span className="ai-selection-face-group-cover ai-selection-co-photo-cover"><ThumbImage src={source} alt="" /></span>
}
