export const DEFAULT_SATURATION = -80
export const DEFAULT_GRAY = 70
export const DEFAULT_TRANSITION_DURATION = 2.5
export const DEFAULT_INITIAL_HOLD_DURATION = 0.2
export const DEFAULT_MIDPOINT_HOLD_DURATION = 0.8
export const DEFAULT_STAGE_MODE = 'two' as const
export const IMAGE_CREATIVE_DURATION = 5

export function savedGray(state: { gray?: number; contrast?: number } | undefined): number {
  if (typeof state?.gray === 'number') return state.gray
  if (typeof state?.contrast === 'number') return Math.min(100, state.contrast * 3)
  return DEFAULT_GRAY
}

export function colorRevealCreativeDuration(isImage: boolean, sourceDuration: number, effectStart: number): number {
  return isImage ? IMAGE_CREATIVE_DURATION : sourceDuration + effectStart
}

export function colorRevealTransitionMax(
  isImage: boolean,
  creativeDuration: number,
  sourceDuration: number,
  effectStart: number,
  midpointHoldDuration: number,
): number {
  const available = isImage
    ? creativeDuration - effectStart - midpointHoldDuration
    : sourceDuration || 8
  return Math.max(0.5, Math.min(8, available))
}
