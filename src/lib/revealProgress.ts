import type { CompositionReveal } from '../shared/types'

function easeInOutCubic(value: number): number {
  const progress = Math.max(0, Math.min(1, value))
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
}

function applyEasing(value: number, easing: CompositionReveal['easing']): number {
  return easing === 'ease-in-out' ? easeInOutCubic(value) : value
}

/** 计算线性或带中段停顿的揭示进度。duration 只计算运动时间。 */
export function compositionRevealProgress(reveal: CompositionReveal, time: number): number {
  const duration = Math.max(0.001, reveal.duration)
  const elapsed = time - reveal.start
  if (elapsed <= 0) return 0

  const midpointHold = Math.max(0, reveal.midpointHold ?? 0)
  if (midpointHold <= 0) {
    return applyEasing(Math.min(1, elapsed / duration), reveal.easing)
  }

  const halfDuration = duration / 2
  if (elapsed < halfDuration) {
    return applyEasing(elapsed / halfDuration, reveal.easing) * 0.5
  }
  if (elapsed < halfDuration + midpointHold) return 0.5
  if (elapsed < duration + midpointHold) {
    const secondHalf = (elapsed - halfDuration - midpointHold) / halfDuration
    return 0.5 + applyEasing(secondHalf, reveal.easing) * 0.5
  }
  return 1
}
