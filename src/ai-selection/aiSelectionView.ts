import type { AiSelectionItem } from '../shared/types'

export type AiSelectionResultFilter = 'recommended' | 'compare' | 'review' | 'video' | 'selected' | 'all'

export function isReviewItem(item: AiSelectionItem): boolean {
  return Boolean(item.error) || item.quality?.grade === 'review' || item.semanticTags.includes('建议复查')
}

export function isRecommendedItem(item: AiSelectionItem): boolean {
  return item.kind === 'image'
    && !isReviewItem(item)
    && Boolean(item.recommendationReason)
    && item.recommendationReason !== '相似组备选'
}

export function matchesResultFilter(item: AiSelectionItem, filter: AiSelectionResultFilter): boolean {
  if (filter === 'recommended') return isRecommendedItem(item)
  if (filter === 'compare') return item.kind === 'image' && Boolean(item.similarityGroupId)
  if (filter === 'review') return isReviewItem(item)
  if (filter === 'video') return item.kind === 'video'
  if (filter === 'selected') return item.selected
  return true
}

export function matchesSelectionSearch(item: AiSelectionItem, search: string): boolean {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${item.name} ${item.semanticTags.join(' ')} ${item.recommendationReason ?? ''} ${item.quality?.reasons.join(' ') ?? ''}`.toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term)
    || (['人', '人物', '人像', 'portrait'].some((word) => term.includes(word)) && item.semanticTags.includes('人物'))
    || (['夜', '晚上', '暗光', 'night'].some((word) => term.includes(word)) && item.semanticTags.includes('夜景'))
    || (['闭眼', '眨眼'].some((word) => term.includes(word)) && ['闭眼', '眨眼'].some((tag) => item.semanticTags.includes(tag)))
    || (['切镜', '转场', '变化'].some((word) => term.includes(word)) && item.semanticTags.includes('镜头变化')))
}

export function countSimilarityGroups(items: AiSelectionItem[]): number {
  return new Set(items.map((item) => item.similarityGroupId).filter(Boolean)).size
}
