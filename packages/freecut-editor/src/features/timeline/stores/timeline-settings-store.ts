import { create } from 'zustand'

/**
 * Timeline settings state - FPS, scroll position, snap, dirty tracking.
 * These are UI/editor settings, not timeline content.
 */

interface TimelineSettingsState {
  fps: number
  scrollPosition: number
  snapEnabled: boolean
  audioSkimmingEnabled: boolean
  isDirty: boolean
  changeVersion: number
  /** True while loadTimeline() is in progress - used to coordinate initial player sync */
  isTimelineLoading: boolean
}

interface TimelineSettingsActions {
  setFps: (fps: number) => void
  setScrollPosition: (position: number) => void
  setSnapEnabled: (enabled: boolean) => void
  toggleSnap: () => void
  setAudioSkimmingEnabled: (enabled: boolean) => void
  toggleAudioSkimming: () => void
  setIsDirty: (dirty: boolean) => void
  markDirty: () => void
  markClean: (expectedChangeVersion?: number) => void
  setTimelineLoading: (loading: boolean) => void
}

export const useTimelineSettingsStore = create<TimelineSettingsState & TimelineSettingsActions>()(
  (set) => ({
    // State
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    audioSkimmingEnabled: true,
    isDirty: false,
    changeVersion: 0,
    isTimelineLoading: true, // Start true - set false after loadTimeline completes

    // Actions
    setFps: (fps) => set({ fps }),
    setScrollPosition: (position) => set({ scrollPosition: position }),
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    setAudioSkimmingEnabled: (enabled) => set({ audioSkimmingEnabled: enabled }),
    toggleAudioSkimming: () =>
      set((state) => ({ audioSkimmingEnabled: !state.audioSkimmingEnabled })),
    setIsDirty: (dirty) =>
      set((state) => ({
        isDirty: dirty,
        changeVersion: dirty ? state.changeVersion + 1 : state.changeVersion,
      })),
    markDirty: () =>
      set((state) => ({ isDirty: true, changeVersion: state.changeVersion + 1 })),
    markClean: (expectedChangeVersion) =>
      set((state) =>
        expectedChangeVersion === undefined || state.changeVersion === expectedChangeVersion
          ? { isDirty: false }
          : state,
      ),
    setTimelineLoading: (loading) => set({ isTimelineLoading: loading }),
  }),
)
