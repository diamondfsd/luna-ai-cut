const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v']

function getExtension(url: string): string {
  const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  return match ? `.${match[1].toLowerCase()}` : ''
}

function isImage(url: string): boolean {
  return IMAGE_EXTENSIONS.includes(getExtension(url))
}

function isVideo(url: string): boolean {
  return VIDEO_EXTENSIONS.includes(getExtension(url))
}

import './PreviewStage.css'

interface PreviewStageProps {
  url: string | null
}

export function PreviewStage({ url }: PreviewStageProps) {
  if (!url) return null

  return (
    <div className="preview-stage">
      {isImage(url) && <img src={url} alt="" />}
      {isVideo(url) && <video src={url} controls autoPlay />}
    </div>
  )
}
