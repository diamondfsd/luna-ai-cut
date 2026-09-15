import path from 'node:path'

const GENERATED_MUSIC_MEDIA_PREFIX = 'generated-music:'

export function generatedMusicMediaId(filePath: string): string {
  return `${GENERATED_MUSIC_MEDIA_PREFIX}${encodeURIComponent(path.basename(filePath))}`
}

export function generatedMusicFileName(mediaId: string): string | null {
  if (!mediaId.startsWith(GENERATED_MUSIC_MEDIA_PREFIX)) return null
  const encoded = mediaId.slice(GENERATED_MUSIC_MEDIA_PREFIX.length)
  if (!encoded) return null
  try {
    const fileName = decodeURIComponent(encoded)
    return path.basename(fileName) === fileName ? fileName : null
  } catch {
    return null
  }
}
