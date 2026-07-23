export type BasicMediaKind = 'image' | 'video' | 'unknown'

export const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif', '.tiff', '.heic', '.heif',
])

export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.m4v', '.lrv', '.ogg',
])

export function fileNameFromPath(filePath: string): string {
  const clean = filePath.split(/[?#]/)[0]
  try {
    const parsed = new URL(clean)
    return decodeURIComponent(parsed.pathname.replace(/\\/g, '/').split('/').pop() || 'unknown')
  } catch {
    return decodeURIComponent(clean.replace(/\\/g, '/').split('/').pop() || 'unknown')
  }
}

export function extensionFromPath(filePath: string): string {
  const name = fileNameFromPath(filePath)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function baseNameFromPath(filePath: string): string {
  const name = fileNameFromPath(filePath)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function mediaKindFromPath(filePath: string): BasicMediaKind {
  const ext = extensionFromPath(filePath)
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'unknown'
}

export function isImagePath(filePath: string): boolean {
  return mediaKindFromPath(filePath) === 'image'
}

export function isVideoPath(filePath: string): boolean {
  return mediaKindFromPath(filePath) === 'video'
}

export function filePathToPreviewUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  if (filePath.startsWith('file://')) return filePath
  const normalized = filePath.replace(/\\/g, '/')
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`)
    .replace(/#/g, '%23').replace(/\?/g, '%3F')
}

export function thumbnailUrlForFile(file: { kind?: string }, filePath?: string | null): string | null {
  if (!filePath) return null
  if (file.kind === 'video' || file.kind === 'lrv') return null
  return filePathToPreviewUrl(filePath)
}
