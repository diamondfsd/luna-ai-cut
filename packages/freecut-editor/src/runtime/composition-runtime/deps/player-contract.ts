/**
 * Adapter exports for player-layer dependencies.
 * Composition runtime modules should import player hooks/components from here.
 */

export {
  AbsoluteFill,
  Sequence,
  SequenceContext,
  interpolate,
  useSequenceContext,
} from '@freecut/runtime/player/composition'
export { VideoConfigProvider } from '@freecut/runtime/player/VideoConfigProvider'
export { useVideoConfig } from '@freecut/runtime/player/video-config-context'
export { useBridgedCurrentFrame, useBridgedIsPlaying } from '@freecut/runtime/player/clock'
export {
  useClock,
  useClockFrameSelector,
  useClockPlaybackRate,
} from '@freecut/runtime/player/clock/clock-hooks'
export { useVideoSourcePool } from '@freecut/runtime/player/video/VideoSourcePoolContext'
export { isVideoPoolAbortError } from '@freecut/runtime/player/video/VideoSourcePool'
