import { create } from 'zustand'
import type { PreviewItemUpdate } from '../utils/item-edit-preview'

interface TrimPreviewState {
  itemId: string | null
  update: PreviewItemUpdate | null
}

interface TrimPreviewActions {
  setPreview: (update: PreviewItemUpdate) => void
  clear: () => void
}

export const useTrimPreviewStore = create<TrimPreviewState & TrimPreviewActions>()((set) => ({
  itemId: null,
  update: null,
  setPreview: (update) => set({ itemId: update.id, update }),
  clear: () => set({ itemId: null, update: null }),
}))
