export type AiEditingReasoningEffort = 'low' | 'high' | 'xhigh' | 'max'

export const REASONING_EFFORT_STORAGE_KEY = 'editor:aiEditingReasoningEffort'
export const REASONING_EFFORTS = new Set<AiEditingReasoningEffort>(['low', 'high', 'xhigh', 'max'])

export function loadReasoningEffort(): AiEditingReasoningEffort {
  if (typeof window === 'undefined') return 'high'
  try {
    const stored = window.localStorage.getItem(REASONING_EFFORT_STORAGE_KEY)
    return stored && REASONING_EFFORTS.has(stored as AiEditingReasoningEffort)
      ? (stored as AiEditingReasoningEffort)
      : 'high'
  } catch {
    return 'high'
  }
}
