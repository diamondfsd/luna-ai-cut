import type { AiSelectionItem, AiSelectionState } from '../shared/types'

export type AiSelectionResultFilter = 'recommended' | 'attention' | 'kept' | 'rejected' | 'all'

export function isReviewItem(item: AiSelectionItem): boolean {
  return item.flags.lowQuality || item.flags.closedEyes || item.flags.analysisFailed
}

export function isAiRecommended(item: AiSelectionItem): boolean {
  if (typeof item.flags.aiRecommended === 'boolean') return item.flags.aiRecommended
  return item.state === 'recommended'
    || (item.state === 'kept' && Boolean(item.recommendationReason) && item.recommendationReason !== '相似组备选')
}

export function matchesResultFilter(item: AiSelectionItem, filter: AiSelectionResultFilter): boolean {
  if (filter === 'recommended') return isAiRecommended(item)
  if (filter === 'attention') return isReviewItem(item) || item.state === 'undecided'
  if (filter === 'kept') return item.state === 'kept'
  if (filter === 'rejected') return item.state === 'rejected'
  return true
}

export function stateLabel(state: AiSelectionState): string {
  return ({ recommended: '推荐', alternative: '备选', kept: '保留', rejected: '排除', undecided: '待确认' } as const)[state]
}

export function countSimilarityGroups(items: AiSelectionItem[]): number {
  return new Set(items.map((item) => item.groupId).filter(Boolean)).size
}
