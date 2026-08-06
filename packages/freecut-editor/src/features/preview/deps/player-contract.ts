/**
 * Single import seam for preview -> player dependencies.
 */

export type { PlayerRef } from '@freecut/runtime/player/contracts/preview'
export {
  AbsoluteFill,
  ClockBridgeProvider,
  getGlobalVideoSourcePool,
  HeadlessPlayer,
  PlayerEmitterProvider,
  useClock,
  useClockIsPlaying,
  useClockPlaybackRate,
  usePlayer,
  useVideoConfig,
  VideoConfigProvider,
} from '@freecut/runtime/player/contracts/preview'
