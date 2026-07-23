export type MaskSelectionOperation = 'replace' | 'add' | 'subtract'

export function hasUsableMask(data: Uint8Array): boolean {
  const requiredPixels = Math.max(16, Math.floor(data.length * 0.0005))
  let selectedPixels = 0
  for (const value of data) {
    if (value >= 128 && ++selectedPixels >= requiredPixels) return true
  }
  return false
}

export function combineMaskValue(
  base: number,
  incoming: number,
  operation: Exclude<MaskSelectionOperation, 'replace'>,
): number {
  if (operation === 'add') return Math.max(base, incoming)
  return Math.round(base * (255 - incoming) / 255)
}

export function applyMaskSelectionOperation(
  base: Uint8Array,
  incoming: Uint8Array,
  operation: MaskSelectionOperation,
): Uint8Array {
  if (base.length !== incoming.length) throw new Error('蒙版尺寸不一致')
  if (operation === 'replace') return new Uint8Array(incoming)

  const result = new Uint8Array(base.length)
  for (let index = 0; index < base.length; index += 1) {
    result[index] = combineMaskValue(base[index], incoming[index], operation)
  }
  return result
}

export function resampleMask(
  data: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return new Uint8Array(data)
  const result = new Uint8Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = ((y + 0.5) * sourceHeight / targetHeight) - 0.5
    const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sourceY)))
    const y1 = Math.min(sourceHeight - 1, y0 + 1)
    const fy = Math.max(0, sourceY - y0)
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = ((x + 0.5) * sourceWidth / targetWidth) - 0.5
      const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sourceX)))
      const x1 = Math.min(sourceWidth - 1, x0 + 1)
      const fx = Math.max(0, sourceX - x0)
      const top = data[y0 * sourceWidth + x0] * (1 - fx) + data[y0 * sourceWidth + x1] * fx
      const bottom = data[y1 * sourceWidth + x0] * (1 - fx) + data[y1 * sourceWidth + x1] * fx
      result[y * targetWidth + x] = Math.round(top * (1 - fy) + bottom * fy)
    }
  }
  return result
}
