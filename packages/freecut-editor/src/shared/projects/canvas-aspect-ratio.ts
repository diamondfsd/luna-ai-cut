export interface CanvasAspectRatioPreset {
  id: string
  label: string
  ratio: number
}

export const CANVAS_ASPECT_RATIO_PRESETS: readonly CanvasAspectRatioPreset[] = [
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '2.35:1', label: '2.35:1', ratio: 2.35 },
  { id: '2:1', label: '2:1', ratio: 2 },
  { id: '1.85:1', label: '1.85:1', ratio: 1.85 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '1:2', label: '1:2', ratio: 1 / 2 },
] as const

function roundToEven(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded + 1
}

export function resizeCanvasToAspectRatio(
  canvas: { width: number; height: number },
  aspectRatio: number,
): { width: number; height: number } {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return canvas
  }

  const longEdge = Math.max(canvas.width, canvas.height)
  if (aspectRatio >= 1) {
    return {
      width: roundToEven(longEdge),
      height: roundToEven(longEdge / aspectRatio),
    }
  }

  return {
    width: roundToEven(longEdge * aspectRatio),
    height: roundToEven(longEdge),
  }
}

export function findCanvasAspectRatioPreset(width: number, height: number) {
  if (width <= 0 || height <= 0) return undefined
  const ratio = width / height
  return CANVAS_ASPECT_RATIO_PRESETS.find(
    (preset) => Math.abs(preset.ratio - ratio) / preset.ratio < 0.005,
  )
}
