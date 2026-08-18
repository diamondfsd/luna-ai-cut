import type { PreviewQuality } from '@freecut/shared/state/playback'

/**
 * The composition canvas keeps the project's native geometry. Only decoded
 * video frames are reduced during an active scrub, so effects and layout keep
 * the same coordinate system as playback and export.
 */
export function getActivePreviewDecodeMaxDimension(
  width: number,
  height: number,
  quality: PreviewQuality,
): number | undefined {
  const maxProjectDimension = Math.max(1, Math.round(width), Math.round(height))
  // Full quality is still intentionally reduced while the pointer is moving.
  // The selected quality remains the upper bound for the drag path.
  const scrubQuality = quality === 1 ? 0.5 : quality
  if (scrubQuality >= 1) return undefined
  return Math.max(1, Math.round(maxProjectDimension * scrubQuality))
}
