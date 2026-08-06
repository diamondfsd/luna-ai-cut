import type { EditPipeline } from '../shared/editPipeline'

export type AutoColorPatch = Pick<EditPipeline['color'],
  | 'whiteBalanceMode'
  | 'exposure'
  | 'temperature'
  | 'tint'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'vibrance'
  | 'saturation'
>

interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface Sample {
  r: number
  g: number
  b: number
  luminance: number
  saturation: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rounded(value: number, digits = 0): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function quantile(sorted: number[], position: number): number {
  if (sorted.length === 0) return 0
  const index = clamp(position, 0, 1) * (sorted.length - 1)
  const low = Math.floor(index)
  const high = Math.ceil(index)
  const mix = index - low
  return sorted[low] * (1 - mix) + sorted[high] * mix
}

function collectSamples(input: PixelBuffer): Sample[] {
  if (input.width <= 0 || input.height <= 0 || input.data.length !== input.width * input.height * 4) return []
  const samples: Sample[] = []
  for (let offset = 0; offset < input.data.length; offset += 4) {
    if (input.data[offset + 3] < 128) continue
    const r = input.data[offset] / 255
    const g = input.data[offset + 1] / 255
    const b = input.data[offset + 2] / 255
    const maximum = Math.max(r, g, b)
    const minimum = Math.min(r, g, b)
    samples.push({
      r,
      g,
      b,
      luminance: r * 0.2126 + g * 0.7152 + b * 0.0722,
      saturation: maximum <= 0.001 ? 0 : (maximum - minimum) / maximum,
    })
  }
  return samples
}

function whiteBalance(samples: Sample[]): { temperature: number; tint: number } {
  const neutral = samples.filter((sample) => (
    sample.luminance >= 0.12 && sample.luminance <= 0.9 && sample.saturation <= 0.2
  ))
  const candidates = neutral.length >= Math.max(32, samples.length * 0.015)
    ? neutral
    : samples.filter((sample) => sample.luminance >= 0.18 && sample.luminance <= 0.82)
  if (candidates.length === 0) return { temperature: 0, tint: 0 }

  const channels = candidates.reduce((total, sample) => ({
    r: total.r + sample.r,
    g: total.g + sample.g,
    b: total.b + sample.b,
  }), { r: 0, g: 0, b: 0 })
  const r = channels.r / candidates.length
  const g = channels.g / candidates.length
  const b = channels.b / candidates.length
  const skinShare = samples.filter((sample) => (
    sample.r > sample.g && sample.g > sample.b
    && sample.r - sample.g >= 0.025 && sample.r - sample.g <= 0.22
    && sample.g - sample.b <= 0.18 && sample.luminance >= 0.18 && sample.luminance <= 0.88
  )).length / samples.length
  const limit = skinShare > 0.08 ? 14 : 24
  return {
    temperature: rounded(clamp((b - r) * 115, -limit, limit)),
    tint: rounded(clamp((g - (r + b) / 2) * 100, -Math.min(limit, 18), Math.min(limit, 18))),
  }
}

export function analyzeAutoColor(input: PixelBuffer): AutoColorPatch | null {
  const samples = collectSamples(input)
  if (samples.length < 64) return null
  const luminance = samples.map((sample) => sample.luminance).sort((a, b) => a - b)
  const p02 = quantile(luminance, 0.02)
  const p10 = quantile(luminance, 0.1)
  const median = quantile(luminance, 0.5)
  const p90 = quantile(luminance, 0.9)
  const p98 = quantile(luminance, 0.98)
  if (p98 < 0.025 || p02 > 0.975) return null

  const spread = Math.max(0.05, p90 - p10)
  const exposure = clamp(Math.log2(0.46 / clamp(median, 0.06, 0.94)) * 0.72, -1.25, 1.25)
  const contrast = clamp((0.62 - spread) * 55, -18, 22)
  const shadows = p10 < 0.12 ? clamp((0.12 - p10) * 210, 0, 28) : 0
  const highlights = p90 > 0.82 ? -clamp((p90 - 0.82) * 150, 0, 28) : 0
  const blacks = clamp((0.035 - p02) * 260, -12, 12)
  const whites = clamp((0.94 - p98) * 110, -12, 14)
  const colorful = samples.map((sample) => sample.saturation).filter((value) => value > 0.06).sort((a, b) => a - b)
  const medianSaturation = quantile(colorful, 0.5)
  const vibrance = clamp((0.38 - medianSaturation) * 45, -10, 16)
  const saturation = medianSaturation > 0.72 ? -clamp((medianSaturation - 0.72) * 35, 0, 8) : 0
  const balance = whiteBalance(samples)

  return {
    whiteBalanceMode: 'custom',
    exposure: rounded(exposure, 2),
    temperature: balance.temperature,
    tint: balance.tint,
    contrast: rounded(contrast),
    highlights: rounded(highlights),
    shadows: rounded(shadows),
    whites: rounded(whites),
    blacks: rounded(blacks),
    vibrance: rounded(vibrance),
    saturation: rounded(saturation),
  }
}

