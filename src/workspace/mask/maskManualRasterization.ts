import type { ColorMaskComponentOperation } from '../shared/editPipeline'
import { applyMaskSelectionOperation, combineMaskValue, type MaskSelectionOperation } from './maskSelectionOperations'

export function drawMaskBrush(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): void {
  const minX = Math.max(0, Math.floor(x - radius))
  const maxX = Math.min(width - 1, Math.ceil(x + radius))
  const minY = Math.max(0, Math.floor(y - radius))
  const maxY = Math.min(height - 1, Math.ceil(y + radius))
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const distance = Math.hypot(px - x, py - y)
      if (distance > radius) continue
      const edge = Math.max(0, Math.min(1, (radius - distance) / Math.max(1, radius * 0.25)))
      const index = py * width + px
      data[index] = combineMaskValue(data[index], Math.round(edge * 255), 'add')
    }
  }
}

export function applyComponentDraft(base: Uint8Array, incoming: Uint8Array, operation: ColorMaskComponentOperation): Uint8Array {
  if (operation !== 'intersect') return applyMaskSelectionOperation(base, incoming, operation as MaskSelectionOperation)
  const result = new Uint8Array(base.length)
  for (let index = 0; index < base.length; index += 1) result[index] = Math.round(base[index] * incoming[index] / 255)
  return result
}
