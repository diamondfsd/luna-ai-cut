import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'

import { ThumbImage } from '../components/ThumbImage'
import { squareCropAroundCenter } from '../shared/aiAvatarCrop'
import './AiPersonIdentityAvatar.css'

interface AiPersonIdentityAvatarProps {
  avatarDataUrl: string | null
  coverUrl: string | null
  coverBounds: { x: number; y: number; width: number; height: number } | null
  className?: string
}

export function AiPersonIdentityAvatar({ avatarDataUrl, coverUrl, coverBounds, className }: AiPersonIdentityAvatarProps) {
  const source = avatarDataUrl ?? coverUrl
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => { setImageSize(null) }, [source])

  const bounds = avatarDataUrl || !coverBounds
    ? { x: 0, y: 0, width: 1, height: 1 }
    : imageSize ? squareCropAroundCenter(coverBounds, imageSize.width, imageSize.height) : coverBounds
  return <span className={`ai-person-identity-avatar${className ? ` ${className}` : ''}`}>
    {source ? <ThumbImage src={source} alt="" onLoad={(event) => {
      if (event.currentTarget.src.startsWith('data:image/svg+xml')) return
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget
      if (width > 0 && height > 0) setImageSize((current) => current?.width === width && current.height === height ? current : { width, height })
    }} style={{
      width: `${100 / bounds.width}%`,
      height: `${100 / bounds.height}%`,
      left: `${-bounds.x / bounds.width * 100}%`,
      top: `${-bounds.y / bounds.height * 100}%`,
    }} /> : <UserRound size={18} />}
  </span>
}
