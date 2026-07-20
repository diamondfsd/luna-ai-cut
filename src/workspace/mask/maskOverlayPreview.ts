import { featherMaskPreview, sampleMaskBilinear } from './maskPreviewSampling'

interface Size {
  width: number
  height: number
}

export function buildMaskOverlayPreview(
  data: Uint8Array,
  maskSize: Size,
  displaySize: Size,
  displayToSource: (x: number, y: number) => { x: number; y: number },
  inverted: boolean,
  feather: number,
): Float32Array {
  const preview = new Float32Array(displaySize.width * displaySize.height)
  const center = displayToSource(0.5, 0.5)
  const stepX = displayToSource(0.5 + 1 / displaySize.width, 0.5)
  const stepY = displayToSource(0.5, 0.5 + 1 / displaySize.height)
  const sourcePixelsPerPreviewPixelX = Math.max(0.0001, Math.hypot(
    (stepX.x - center.x) * maskSize.width,
    (stepX.y - center.y) * maskSize.height,
  ))
  const sourcePixelsPerPreviewPixelY = Math.max(0.0001, Math.hypot(
    (stepY.x - center.x) * maskSize.width,
    (stepY.y - center.y) * maskSize.height,
  ))
  for (let y = 0; y < displaySize.height; y += 1) {
    for (let x = 0; x < displaySize.width; x += 1) {
      const source = displayToSource((x + 0.5) / displaySize.width, (y + 0.5) / displaySize.height)
      if (source.x < 0 || source.x > 1 || source.y < 0 || source.y > 1) continue
      const selected = sampleMaskBilinear(data, maskSize.width, maskSize.height, source.x, source.y)
      preview[y * displaySize.width + x] = inverted ? 255 - selected : selected
    }
  }
  return featherMaskPreview(preview, displaySize.width, displaySize.height, feather, sourcePixelsPerPreviewPixelX, sourcePixelsPerPreviewPixelY)
}
