import type { TransformProperties } from '@freecut/types/transform'

export interface NormalizedTextBox {
  left: number
  top: number
  width: number
  height: number
}

interface CanvasSize {
  width: number
  height: number
}

export function normalizedTextBoxFromTransform(
  transform: TransformProperties | undefined,
  canvas: CanvasSize,
): NormalizedTextBox {
  const width = transform?.width ?? canvas.width
  const height = transform?.height ?? canvas.height
  return {
    left: (canvas.width / 2 + (transform?.x ?? 0) - width / 2) / canvas.width,
    top: (canvas.height / 2 + (transform?.y ?? 0) - height / 2) / canvas.height,
    width: width / canvas.width,
    height: height / canvas.height,
  }
}

export function transformFromNormalizedTextBox(
  box: NormalizedTextBox,
  canvas: CanvasSize,
): Pick<TransformProperties, 'x' | 'y' | 'width' | 'height'> {
  const width = box.width * canvas.width
  const height = box.height * canvas.height
  return {
    x: box.left * canvas.width + width / 2 - canvas.width / 2,
    y: box.top * canvas.height + height / 2 - canvas.height / 2,
    width,
    height,
  }
}

export function isNormalizedTextBox(value: unknown): value is NormalizedTextBox {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const box = value as Record<string, unknown>
  const values = [box.left, box.top, box.width, box.height]
  if (values.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) return false
  const { left, top, width, height } = box as unknown as NormalizedTextBox
  return left >= 0 && top >= 0 && width > 0 && height > 0 &&
    left <= 1 && top <= 1 && width <= 1 && height <= 1 &&
    left + width <= 1.000_001 && top + height <= 1.000_001
}
