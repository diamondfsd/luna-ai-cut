import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

export interface TimelineContextValue {
  frame: number
  playing: boolean
  rootId: string
  playbackRate: number
  imperativePlaying: MutableRefObject<boolean>
  setPlaybackRate: (rate: number) => void
  inFrame: number | null
  outFrame: number | null
}

export interface SetTimelineContextValue {
  setFrame: Dispatch<SetStateAction<Record<string, number>>>
  setPlaying: Dispatch<SetStateAction<boolean>>
}

interface TimelinePlaybackContextValue {
  playing: boolean
  playbackRate: number
  imperativePlaying: MutableRefObject<boolean>
  setPlaybackRate: (rate: number) => void
}

interface TimelineBoundsContextValue {
  rootId: string
  inFrame: number | null
  outFrame: number | null
}

export const BridgedTimelineFrameContext = createContext<number | null>(null)
export const BridgedTimelinePlaybackContext = createContext<TimelinePlaybackContextValue | null>(
  null,
)
export const BridgedTimelineBoundsContext = createContext<TimelineBoundsContextValue | null>(null)
export const BridgedSetTimelineContext = createContext<SetTimelineContextValue | null>(null)

export function useBridgedTimelineContext(): TimelineContextValue {
  const frame = useContext(BridgedTimelineFrameContext)
  const playback = useContext(BridgedTimelinePlaybackContext)
  const bounds = useContext(BridgedTimelineBoundsContext)
  if (frame === null || !playback || !bounds) {
    throw new Error('useBridgedTimelineContext must be used within a ClockBridgeProvider')
  }
  return useMemo(() => ({ frame, ...playback, ...bounds }), [bounds, frame, playback])
}

export function useBridgedSetTimelineContext(): SetTimelineContextValue {
  const context = useContext(BridgedSetTimelineContext)
  if (!context) {
    throw new Error('useBridgedSetTimelineContext must be used within a ClockBridgeProvider')
  }
  return context
}

export function useBridgedCurrentFrame(): number {
  const frame = useContext(BridgedTimelineFrameContext)
  if (frame === null) {
    throw new Error('useBridgedCurrentFrame must be used within a ClockBridgeProvider')
  }
  return frame
}

export function useBridgedIsPlaying(): boolean {
  const playback = useContext(BridgedTimelinePlaybackContext)
  if (!playback) {
    throw new Error('useBridgedIsPlaying must be used within a ClockBridgeProvider')
  }
  return playback.playing
}

export function useBridgedSetTimelineFrame(): (frame: number) => void {
  const { setFrame } = useBridgedSetTimelineContext()
  const bounds = useContext(BridgedTimelineBoundsContext)
  if (!bounds) {
    throw new Error('useBridgedSetTimelineFrame must be used within a ClockBridgeProvider')
  }
  const { inFrame, outFrame } = bounds

  return useCallback(
    (newFrame: number) => {
      let clampedFrame = newFrame
      if (inFrame !== null && clampedFrame < inFrame) {
        clampedFrame = inFrame
      }
      if (outFrame !== null && clampedFrame > outFrame) {
        clampedFrame = outFrame
      }

      setFrame((c) => ({
        ...c,
        'player-comp': clampedFrame,
      }))
    },
    [setFrame, inFrame, outFrame],
  )
}

export function useBridgedActualFirstFrame(): number {
  const bounds = useContext(BridgedTimelineBoundsContext)
  if (!bounds) {
    throw new Error('useBridgedActualFirstFrame must be used within a ClockBridgeProvider')
  }
  const { inFrame } = bounds
  return inFrame ?? 0
}

export function useBridgedActualLastFrame(durationInFrames: number): number {
  const bounds = useContext(BridgedTimelineBoundsContext)
  if (!bounds) {
    throw new Error('useBridgedActualLastFrame must be used within a ClockBridgeProvider')
  }
  const { outFrame } = bounds
  return outFrame ?? durationInFrames - 1
}
