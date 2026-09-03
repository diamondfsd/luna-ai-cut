import type { CompositionBounds } from '../../shared/compositionAnalysis'
import { compositionScoreForBounds } from '../../shared/compositionAnalysis'
import type { CropRect } from '../shared/editPipeline'
import { clampCrop, fitCropInsideImage, framePointToSourceUv, maxCropInsideImage, sameCrop, sourceUvToFramePoint, type CropConstraintOptions } from './cropGeometry'

export interface AiCropSuggestion {
  crop: CropRect
  score: number
  currentScore: number
  subjectBounds: CompositionBounds
  reason: string
}

export interface AiCropCandidateSet {
  subjectBounds: CompositionBounds
  candidates: CropRect[]
  currentIndex: number
}

const MIN_SUGGESTION_SCORE_GAIN = 0.01
const MAX_SCORABLE_CANDIDATES = 31

function sourceBoundsToFrameBounds(bounds: CompositionBounds, options: CropConstraintOptions): CompositionBounds {
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => sourceUvToFramePoint(point, options.sourceAspect, options.orientation, options.rotate))
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)))
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)))
  const maxX = Math.min(1, Math.max(...points.map((point) => point.x)))
  const maxY = Math.min(1, Math.max(...points.map((point) => point.y)))
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}

function cropContainsBounds(crop: CropRect, bounds: CompositionBounds, padding = 0.01): boolean {
  return bounds.x >= crop.x - padding
    && bounds.y >= crop.y - padding
    && bounds.x + bounds.width <= crop.x + crop.w + padding
    && bounds.y + bounds.height <= crop.y + crop.h + padding
}

function scoreCrop(crop: CropRect, bounds: CompositionBounds): number {
  const localBounds: CompositionBounds = {
    x: (bounds.x - crop.x) / crop.w,
    y: (bounds.y - crop.y) / crop.h,
    width: bounds.width / crop.w,
    height: bounds.height / crop.h,
  }
  return compositionScoreForBounds(localBounds).normalized
}

function reasonForCrop(crop: CropRect, bounds: CompositionBounds): string {
  const centerX = (bounds.x + bounds.width / 2 - crop.x) / crop.w
  const centerY = (bounds.y + bounds.height / 2 - crop.y) / crop.h
  const horizontal = centerX < 0.42 ? '左侧' : centerX > 0.58 ? '右侧' : '中间'
  const vertical = centerY < 0.42 ? '上方' : centerY > 0.58 ? '下方' : '中间'
  return `主体位于画面${horizontal}${vertical}，留白更均衡`
}

export function compositionCropCandidates(
  sourceBounds: CompositionBounds | null,
  options: CropConstraintOptions,
  currentCrop: CropRect | null,
): AiCropCandidateSet | null {
  if (!sourceBounds) return null
  const subjectBounds = sourceBoundsToFrameBounds(sourceBounds, options)
  if (subjectBounds.width <= 0 || subjectBounds.height <= 0) return null

  const base = maxCropInsideImage(options)
  const scales = currentCrop && currentCrop.w < 0.98 && currentCrop.h < 0.98
    ? [1, 0.92, 0.82]
    : [0.92, 0.82, 0.72]
  const anchors = [1 / 3, 0.5, 2 / 3]
  const candidates: CropRect[] = []
  const addCandidate = (scale: number, anchorX: number, anchorY: number): void => {
    if (candidates.length >= MAX_SCORABLE_CANDIDATES) return
    const width = base.w * scale
    const height = base.h * scale
    const candidate = fitCropInsideImage(clampCrop({
      x: subjectBounds.x + subjectBounds.width / 2 - anchorX * width,
      y: subjectBounds.y + subjectBounds.height / 2 - anchorY * height,
      w: width,
      h: height,
    }), options.sourceAspect, options.orientation, options.rotate)
    if (cropContainsBounds(candidate, subjectBounds) && !candidates.some((existing) => sameCrop(existing, candidate))) {
      candidates.push(candidate)
    }
  }
  for (const scale of scales) {
    for (const anchorX of anchors) {
      for (const anchorY of anchors) {
        addCandidate(scale, anchorX, anchorY)
      }
    }
  }
  // Add two extra composition styles within the scorer's 32-crop request limit:
  // a wider environmental frame and a tighter subject-focused frame.
  for (const [scale, anchorX, anchorY] of [
    [1, 1 / 3, 0.5],
    [1, 2 / 3, 0.5],
    [0.62, 0.5, 0.5],
    [0.62, 0.5, 1 / 3],
  ] as const) {
    addCandidate(scale, anchorX, anchorY)
  }
  const effectiveCurrentCrop = currentCrop
    ? fitCropInsideImage(clampCrop(currentCrop), options.sourceAspect, options.orientation, options.rotate)
    : base
  // Keep the current crop in the scored set even when it cuts through the subject.
  // Otherwise the last generated candidate would be mistaken for the current score.
  candidates.push(effectiveCurrentCrop)

  const currentIndex = candidates.length - 1
  return { subjectBounds, candidates, currentIndex }
}

export function suggestCompositionCrop(
  sourceBounds: CompositionBounds | null,
  options: CropConstraintOptions,
  currentCrop: CropRect | null,
  modelScores?: number[],
): AiCropSuggestion | null {
  const candidateSet = compositionCropCandidates(sourceBounds, options, currentCrop)
  if (!candidateSet) return null
  const { subjectBounds, candidates, currentIndex } = candidateSet

  const scores = modelScores ?? []
  const hasModelScores = scores.length === candidates.length && scores.every(Number.isFinite)
  const bestIndex = hasModelScores
    ? scores.reduce((winner, score, index) => score > scores[winner] ? index : winner, 0)
    : candidates.reduce((winner, candidate, index) => (
      scoreCrop(candidate, subjectBounds) > scoreCrop(candidates[winner], subjectBounds) ? index : winner
    ), 0)
  const score = hasModelScores ? scores[bestIndex] : scoreCrop(candidates[bestIndex], subjectBounds)
  const currentScore = hasModelScores
    ? scores[currentIndex]
    : scoreCrop(candidates[currentIndex], subjectBounds)
  // Do not present the current crop as an actionable recommendation. Model scores can
  // be very close, so require a small but meaningful improvement before moving the frame.
  if (bestIndex === currentIndex || sameCrop(candidates[bestIndex], candidates[currentIndex]) || score <= currentScore + MIN_SUGGESTION_SCORE_GAIN) {
    return null
  }
  return {
    crop: candidates[bestIndex],
    score,
    currentScore,
    subjectBounds,
    reason: reasonForCrop(candidates[bestIndex], subjectBounds),
  }
}

export function cropSourceBounds(crop: CropRect, options: CropConstraintOptions): CompositionBounds {
  const points = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.w, y: crop.y },
    { x: crop.x, y: crop.y + crop.h },
    { x: crop.x + crop.w, y: crop.y + crop.h },
  ].map((point) => framePointToSourceUv(point, options.sourceAspect, options.orientation, options.rotate))
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)))
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)))
  const maxX = Math.min(1, Math.max(...points.map((point) => point.x)))
  const maxY = Math.min(1, Math.max(...points.map((point) => point.y)))
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}
