import type { PreviewLayer } from '../shared/types'

const COLOR_KEYS = [
  'exposure',
  'brightness',
  'contrast',
  'saturation',
  'vibrance',
  'temperature',
  'tint',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'clarity',
  'texture',
  'sharpen',
  'denoise',
  'skinSmoothing',
  'glowStrength',
] as const

function roundedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 1_000_000) / 1_000_000
    : null
}

/** Keep preview logs useful without serializing masks, curves, or full file paths repeatedly. */
export function summarizePreviewColor(color: unknown): Record<string, number | null> | null {
  if (!color || typeof color !== 'object') return null
  const source = color as Record<string, unknown>
  return Object.fromEntries(COLOR_KEYS.map((key) => [key, roundedNumber(source[key])]))
}

export function previewLayerSignature(layers: PreviewLayer[]): string {
  const serialized = JSON.stringify(layers)
  let hash = 2_166_136_261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${serialized.length}`
}

export function summarizePreviewLayers(layers: PreviewLayer[]): Array<Record<string, unknown>> {
  return layers.map((layer, index) => ({
    index,
    type: layer.layerType ?? 'media',
    role: layer.precomposeRole ?? null,
    group: layer.precomposeGroup ?? null,
    isVideo: Boolean(layer.isVideo),
    filePath: layer.filePath,
    videoTime: roundedNumber(layer.videoTime),
    color: summarizePreviewColor(layer.color),
  }))
}
