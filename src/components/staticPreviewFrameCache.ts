import type { PreviewLayer } from '../shared/types'

export interface CachedPreviewFrame {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

const MAX_CACHE_BYTES = 96 * 1024 * 1024
const MAX_CACHE_ENTRIES = 4
const frames = new Map<string, CachedPreviewFrame>()
let cachedBytes = 0

export function staticPreviewFrameKey(
  layers: PreviewLayer[],
  canvasWidth: number | undefined,
  canvasHeight: number | undefined,
  maxSide: number,
): string | null {
  if (layers.some((layer) => (
    layer.isVideo
    || layer.pixelFlow
    || layer.reveal
    || layer.maskTimeline
    || layer.maskTrack
    || layer.activeStart != null
    || layer.activeEnd != null
  ))) return null
  return JSON.stringify({ canvasWidth, canvasHeight, maxSide, layers })
}

export function getStaticPreviewFrame(key: string): CachedPreviewFrame | undefined {
  const frame = frames.get(key)
  if (!frame) return undefined
  frames.delete(key)
  frames.set(key, frame)
  return frame
}

export function setStaticPreviewFrame(key: string, frame: CachedPreviewFrame): void {
  const existing = frames.get(key)
  if (existing) cachedBytes -= existing.pixels.byteLength
  frames.delete(key)
  frames.set(key, frame)
  cachedBytes += frame.pixels.byteLength
  while (frames.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    const oldest = frames.entries().next().value as [string, CachedPreviewFrame] | undefined
    if (!oldest) break
    frames.delete(oldest[0])
    cachedBytes -= oldest[1].pixels.byteLength
  }
}

export function clearStaticPreviewFrames(): void {
  frames.clear()
  cachedBytes = 0
}
