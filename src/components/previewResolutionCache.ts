import type { MediaResolution } from './previewStageGeometry'

const resolutions = new Map<string, MediaResolution>()

export function getPreviewResolution(filePath: string): MediaResolution | undefined {
  return resolutions.get(filePath)
}

export function setPreviewResolution(filePath: string, resolution: MediaResolution): void {
  resolutions.set(filePath, resolution)
}
