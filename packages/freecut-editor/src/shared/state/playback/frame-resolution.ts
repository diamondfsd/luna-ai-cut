import type { PreviewBridgeState } from '@freecut/shared/state/preview-bridge'
import type { PlaybackState } from './types'

type FrameResolutionInput = Pick<
  PlaybackState,
  'currentFrame' | 'previewFrame' | 'isPlaying' | 'currentFrameEpoch' | 'previewFrameEpoch'
> &
  Pick<PreviewBridgeState, 'displayedFrame'>

/**
 * Resolve the frame that should drive preview-adjacent UI (gizmos, overlays, keyframe probes).
 *
 * Rules:
 * - Playing always follows currentFrame.
 * - While a paused scrub is active, follow displayedFrame to stay in sync with
 *   the frame that the fast-scrub overlay has actually presented.
 * - Once the scrub is released, currentFrame is authoritative. A displayed
 *   frame from the previous overlay must not pin adjacent UI to an old frame.
 * - While a paused scrub has not presented yet, use the most recently updated
 *   preview/current frame.
 */
export function getResolvedPlaybackFrame(input: FrameResolutionInput): number {
  if (input.isPlaying) return input.currentFrame
  if (input.previewFrame === null) return input.currentFrame
  if (input.displayedFrame !== null) return input.displayedFrame
  return input.previewFrameEpoch >= input.currentFrameEpoch
    ? input.previewFrame
    : input.currentFrame
}
