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

function accelerateAfterBounce(value: number): number {
  const compressed = Math.max(0, Math.min(1, value / 0.65))
  return compressed * compressed
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
  if (elapsed < halfDuration + midpointHold) {
    const bounce = Math.max(0, Math.min(0.49, reveal.midpointBounce ?? 0))
    if (bounce <= 0) return 0.5
    const bounceProgress = (elapsed - halfDuration) / midpointHold
    const smoothRecoil = Math.sin(Math.PI * bounceProgress) ** 2
    return 0.5 - smoothRecoil * bounce
  }
  if (elapsed < duration + midpointHold) {
    const secondHalf = (elapsed - halfDuration - midpointHold) / halfDuration
    const secondHalfProgress = (reveal.midpointBounce ?? 0) > 0
      ? accelerateAfterBounce(secondHalf)
      : applyEasing(secondHalf, reveal.easing)
    return 0.5 + secondHalfProgress * 0.5
  }
  return 1
}
