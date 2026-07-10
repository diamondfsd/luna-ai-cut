export interface SlotEdit {
  scale: number
  translateX: number
  translateY: number
  startTime: number
}

export interface TripleStitchSavedState {
  selectedIds: string[]
  activeSlot: number
  slotEdits: SlotEdit[]
  watermarkStyle: string
}

export const DEFAULT_SLOT_EDIT: SlotEdit = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  startTime: 0,
}

export function createDefaultSlotEdits(): SlotEdit[] {
  return Array.from({ length: 3 }, () => ({ ...DEFAULT_SLOT_EDIT }))
}

function storageKey(workspaceKey: string): string {
  return `luna:triple-stitch:${workspaceKey}`
}

export function loadTripleStitchState(
  workspaceKey: string,
  fallbackSelectedIds: string[],
  fallbackWatermarkStyle: string,
  projectState?: Partial<TripleStitchSavedState>,
): TripleStitchSavedState {
  const fallback = {
    selectedIds: fallbackSelectedIds.slice(0, 3),
    activeSlot: 0,
    slotEdits: createDefaultSlotEdits(),
    watermarkStyle: fallbackWatermarkStyle,
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey(workspaceKey))
    const parsed = raw
      ? JSON.parse(raw) as Partial<TripleStitchSavedState>
      : projectState
    if (!parsed) return fallback
    const slotEdits = Array.isArray(parsed.slotEdits)
      ? createDefaultSlotEdits().map((defaultEdit, index) => ({
          ...defaultEdit,
          ...(parsed.slotEdits?.[index] ?? {}),
        }))
      : fallback.slotEdits
    return {
      selectedIds: Array.isArray(parsed.selectedIds)
        ? parsed.selectedIds.filter((id): id is string => typeof id === 'string').slice(0, 3)
        : fallback.selectedIds,
      activeSlot: typeof parsed.activeSlot === 'number'
        ? Math.min(2, Math.max(0, Math.round(parsed.activeSlot)))
        : 0,
      slotEdits,
      watermarkStyle: typeof parsed.watermarkStyle === 'string'
        ? parsed.watermarkStyle
        : fallbackWatermarkStyle,
    }
  } catch {
    return fallback
  }
}

export function saveTripleStitchState(workspaceKey: string, state: TripleStitchSavedState): void {
  try {
    window.sessionStorage.setItem(storageKey(workspaceKey), JSON.stringify(state))
  } catch {
    // 会话存储不可用时不影响当前编辑。
  }
}
