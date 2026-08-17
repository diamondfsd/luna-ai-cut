import type {
  RenderColorAdjustments,
  RenderCurvePoint,
  RenderHslChannelAdjust,
  RenderToneCurveAdjust,
} from '../../shared/types'

export const WEBGPU_CURVE_LUT_WIDTH = 256
export const WEBGPU_HSL_CHANNEL_LIMIT = 12

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeCurvePoints(points: RenderCurvePoint[] | undefined): RenderCurvePoint[] {
  if (!points || points.length === 0) return [{ x: 0, y: 0 }, { x: 1, y: 1 }]

  const sorted = points
    .map((point) => ({
      x: clamp(finiteOr(point.x, 0), 0, 1),
      y: clamp(finiteOr(point.y, 0), 0, 1),
    }))
    .sort((a, b) => a.x - b.x)

  const deduplicated: RenderCurvePoint[] = []
  for (const point of sorted) {
    const previous = deduplicated[deduplicated.length - 1]
    if (!previous || Math.abs(previous.x - point.x) > 0.0005) deduplicated.push(point)
  }
  if (deduplicated.length === 0) return [{ x: 0, y: 0 }, { x: 1, y: 1 }]

  if (deduplicated[0]!.x > 0.0001) {
    deduplicated.unshift({ x: 0, y: deduplicated[0]!.y })
  } else {
    deduplicated[0] = { x: 0, y: deduplicated[0]!.y }
  }

  const last = deduplicated[deduplicated.length - 1]!
  if (last.x < 0.9999) {
    deduplicated.push({ x: 1, y: last.y })
  } else {
    deduplicated[deduplicated.length - 1] = { x: 1, y: last.y }
  }
  return deduplicated
}

function computeMonotoneTangents(points: RenderCurvePoint[]): number[] {
  if (points.length <= 1) return [0]

  const slopes: number[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!
    const right = points[index + 1]!
    slopes.push((right.y - left.y) / Math.max(0.000001, right.x - left.x))
  }

  const tangents = new Array<number>(points.length)
  tangents[0] = slopes[0]!
  tangents[points.length - 1] = slopes[slopes.length - 1]!
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = slopes[index - 1]!
    const next = slopes[index]!
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2
  }

  // Fritsch-Carlson limiting keeps the curve monotone even for steep points.
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index]!
    if (Math.abs(slope) < 0.000001) {
      tangents[index] = 0
      tangents[index + 1] = 0
      continue
    }
    const a = tangents[index]! / slope
    const b = tangents[index + 1]! / slope
    const magnitude = a * a + b * b
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      tangents[index] = scale * a * slope
      tangents[index + 1] = scale * b * slope
    }
  }
  return tangents
}

export function evaluateWebGpuCurve(points: RenderCurvePoint[] | undefined, value: number): number {
  const normalized = normalizeCurvePoints(points)
  const input = clamp(value, 0, 1)
  if (input <= normalized[0]!.x) return normalized[0]!.y
  if (input >= normalized[normalized.length - 1]!.x) return normalized[normalized.length - 1]!.y

  let segmentIndex = normalized.length - 2
  for (let index = 0; index < normalized.length - 1; index += 1) {
    if (input >= normalized[index]!.x && input <= normalized[index + 1]!.x) {
      segmentIndex = index
      break
    }
  }

  const left = normalized[segmentIndex]!
  const right = normalized[segmentIndex + 1]!
  const width = Math.max(0.000001, right.x - left.x)
  const t = clamp((input - left.x) / width, 0, 1)
  const t2 = t * t
  const t3 = t2 * t
  const tangents = computeMonotoneTangents(normalized)
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return clamp(
    h00 * left.y
      + h10 * width * tangents[segmentIndex]!
      + h01 * right.y
      + h11 * width * tangents[segmentIndex + 1]!,
    0,
    1,
  )
}

function curveChannel(curve: RenderToneCurveAdjust | undefined, channel: keyof RenderToneCurveAdjust): RenderCurvePoint[] {
  return curve?.[channel] ?? []
}

/** Build one texture that contains the master, RGB and luminance transfers. */
export function buildWebGpuColorCurveLut(curve: RenderToneCurveAdjust | undefined): Uint8Array {
  const data = new Uint8Array(WEBGPU_CURVE_LUT_WIDTH * 4)
  for (let index = 0; index < WEBGPU_CURVE_LUT_WIDTH; index += 1) {
    const input = index / (WEBGPU_CURVE_LUT_WIDTH - 1)
    const master = evaluateWebGpuCurve(curveChannel(curve, 'rgb'), input)
    const red = evaluateWebGpuCurve(curveChannel(curve, 'red'), master)
    const green = evaluateWebGpuCurve(curveChannel(curve, 'green'), master)
    const blue = evaluateWebGpuCurve(curveChannel(curve, 'blue'), master)
    const luminance = evaluateWebGpuCurve(curveChannel(curve, 'luminance'), input)
    const offset = index * 4
    data[offset] = Math.round(red * 255)
    data[offset + 1] = Math.round(green * 255)
    data[offset + 2] = Math.round(blue * 255)
    data[offset + 3] = Math.round(luminance * 255)
  }
  return data
}

export function webGpuColorCurveCacheKey(curve: RenderToneCurveAdjust | undefined): string {
  if (!curve) return 'identity'
  return (['rgb', 'luminance', 'red', 'green', 'blue'] as const)
    .map((channel) => JSON.stringify(curveChannel(curve, channel)))
    .join('|')
}

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360
}

export function normalizeWebGpuHslChannels(
  channels: RenderHslChannelAdjust[] | undefined,
  limit = WEBGPU_HSL_CHANNEL_LIMIT,
): Float32Array {
  const data = new Float32Array(limit * 4)
  for (let index = 0; index < limit; index += 1) {
    const channel = channels?.[index]
    const offset = index * 4
    data[offset] = normalizeHue(finiteOr(channel?.hue, 0))
    data[offset + 1] = finiteOr(channel?.hueShift, 0)
    data[offset + 2] = finiteOr(channel?.saturation, 0)
    data[offset + 3] = finiteOr(channel?.luminance, 0)
  }
  return data
}

export function webGpuColorCurveLutKey(color: RenderColorAdjustments | undefined): string {
  return webGpuColorCurveCacheKey(color?.curve)
}
