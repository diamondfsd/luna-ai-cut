import { LrcRender } from './LrcRender'
import './PreviewStage.css'

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

interface PreviewStageProps {
  url: string | null
}

export function PreviewStage({ url }: PreviewStageProps) {
  if (!url) return null

  if (isImage(url)) {
    return (
      <div className="preview-stage">
        <LrcRender
          layers={[{ imagePath: url, dstX: 0, dstY: 0, dstW: 1, dstH: 1, fit: 'contain' }]}
        />
      </div>
    )
  }

  if (isVideo(url)) {
    return (
      <div className="preview-stage">
        <LrcRender
          layers={[{ videoPath: url, dstX: 0, dstY: 0, dstW: 1, dstH: 1, fit: 'contain' }]}
        />
      </div>
    )
  }

  return null
}
