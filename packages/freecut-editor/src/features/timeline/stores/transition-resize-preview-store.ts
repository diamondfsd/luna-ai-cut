import { create } from 'zustand'

interface TransitionResizePreviewState {
  transitionId: string | null
  durationInFrames: number | null
}

interface TransitionResizePreviewActions {
  setPreview: (transitionId: string, durationInFrames: number) => void
  clear: () => void
}

export const useTransitionResizePreviewStore = create<
  TransitionResizePreviewState & TransitionResizePreviewActions
>()((set) => ({
  transitionId: null,
  durationInFrames: null,
  setPreview: (transitionId, durationInFrames) => set({ transitionId, durationInFrames }),
  clear: () => set({ transitionId: null, durationInFrames: null }),
}))
