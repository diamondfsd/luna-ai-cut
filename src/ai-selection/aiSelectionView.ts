import type { AiSelectionItem, AiSelectionState } from '../shared/types'

export type AiSelectionResultFilter = 'recommended' | 'attention' | 'kept' | 'rejected' | 'all'

export function isReviewItem(item: AiSelectionItem): boolean {
  return item.flags.lowQuality || item.flags.closedEyes || item.flags.analysisFailed
}

export function matchesResultFilter(item: AiSelectionItem, filter: AiSelectionResultFilter): boolean {
  if (filter === 'recommended') return item.state === 'recommended' || item.state === 'alternative'
  if (filter === 'attention') return isReviewItem(item) || item.state === 'undecided'
  if (filter === 'kept') return item.state === 'kept'
  if (filter === 'rejected') return item.state === 'rejected'
  return true
}

export function matchesSelectionSearch(item: AiSelectionItem, search: string): boolean {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${item.name} ${item.semanticTags.join(' ')} ${item.recommendationReason ?? ''} ${item.quality?.reasons.join(' ') ?? ''}`.toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term)
    || (['人', '人物', '人像', 'portrait'].some((word) => term.includes(word)) && item.semanticTags.includes('人物'))
    || (['夜', '晚上', '暗光', 'night'].some((word) => term.includes(word)) && item.semanticTags.includes('夜景'))
    || (['闭眼', '眨眼'].some((word) => term.includes(word)) && item.flags.closedEyes))
}

export function stateLabel(state: AiSelectionState): string {
  return ({ recommended: '推荐', alternative: '备选', kept: '保留', rejected: '排除', undecided: '待确认' } as const)[state]
}

export function countSimilarityGroups(items: AiSelectionItem[]): number {
  return new Set(items.map((item) => item.groupId).filter(Boolean)).size
}
