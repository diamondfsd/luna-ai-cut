export const COMPOSITION_ANALYSIS_VERSION = 'relic2-cpc-composition-v1'
export const COMPOSITION_MODEL_ID = 'relic2-cpc'
export const COMPOSITION_SCORE_RANGE = { min: 0, max: 3 } as const

export interface CompositionBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CompositionEvidence {
  version: string
  source: 'relic2-cpc' | 'person' | 'subject-mask'
  detected: boolean
  confidence: number
  coverage: number
  bounds: CompositionBounds | null
  score: CompositionScore
  reason: string
}

export interface CompositionScore {
  raw: number | null
  normalized: number
}

export function boundsFromMask(
  bytes: Uint8Array,
  width: number,
  height: number,
  threshold = 128,
): { coverage: number; bounds: CompositionBounds | null } {
  if (width <= 0 || height <= 0 || bytes.length < width * height) return { coverage: 0, bounds: null }
  let count = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (bytes[y * width + x] < threshold) continue
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (count === 0 || maxX < minX || maxY < minY) return { coverage: 0, bounds: null }
  return {
    coverage: count / (width * height),
    bounds: {
      x: minX / width,
      y: minY / height,
      width: (maxX - minX + 1) / width,
      height: (maxY - minY + 1) / height,
    },
  }
}

export function compositionScoreForBounds(bounds: CompositionBounds | null): CompositionScore {
  if (!bounds) return { raw: null, normalized: 0.5 }
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const anchors = [1 / 3, 0.5, 2 / 3]
  const distance = Math.min(...anchors.flatMap((x) => anchors.map((y) => Math.hypot(centerX - x, centerY - y))))
  const placement = Math.max(0, 1 - distance / 0.48)
  const coverage = bounds.width * bounds.height
  const scale = coverage < 0.015
    ? coverage / 0.015
    : coverage > 0.7
      ? Math.max(0, 1 - (coverage - 0.7) / 0.3)
      : 1
  return {
    raw: Number(distance.toFixed(4)),
    normalized: placement * 0.65 + scale * 0.35,
  }
}

export function compositionScoreFromModel(raw: number | null): CompositionScore {
  if (raw === null || !Number.isFinite(raw)) return { raw: null, normalized: 0.5 }
  return {
    raw: Number(raw.toFixed(4)),
    normalized: Math.min(1, Math.max(0, raw / COMPOSITION_SCORE_RANGE.max)),
  }
}

export function compositionEvidenceFromMask(
  bytes: Uint8Array,
  width: number,
  height: number,
  source: CompositionEvidence['source'] = 'subject-mask',
  score: CompositionScore = compositionScoreFromModel(null),
): CompositionEvidence {
  const result = boundsFromMask(bytes, width, height)
  return {
    version: COMPOSITION_ANALYSIS_VERSION,
    source,
    detected: Boolean(result.bounds),
    confidence: result.bounds ? 0.75 : 0,
    coverage: Number(result.coverage.toFixed(4)),
    bounds: result.bounds,
    score,
    reason: result.bounds ? '已找到画面主体' : '没有找到清晰主体',
  }
}

export function compositionEvidenceFromModel(
  raw: number,
  bounds: { coverage: number; bounds: CompositionBounds | null } = { coverage: 0, bounds: null },
): CompositionEvidence {
  const score = compositionScoreFromModel(raw)
  return {
    version: COMPOSITION_ANALYSIS_VERSION,
    source: 'relic2-cpc',
    detected: Number.isFinite(raw),
    confidence: Number.isFinite(raw) ? 0.8 : 0,
    coverage: Number(bounds.coverage.toFixed(4)),
    bounds: bounds.bounds,
    score,
    reason: `ReLIC++ CPC 构图评分 ${Math.round(score.normalized * 100)}`,
  }
}
