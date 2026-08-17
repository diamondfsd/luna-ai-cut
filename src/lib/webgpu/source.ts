export type WebGpuImageSource =
  | HTMLVideoElement
  | HTMLImageElement
  | HTMLCanvasElement
  | OffscreenCanvas
  | ImageBitmap
  | VideoFrame

export interface WebGpuSourceDimensions {
  width: number
  height: number
}

export function getWebGpuSourceDimensions(source: WebGpuImageSource): WebGpuSourceDimensions {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight }
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  const sizedSource = source as HTMLCanvasElement | OffscreenCanvas | ImageBitmap
  return { width: sizedSource.width, height: sizedSource.height }
}
