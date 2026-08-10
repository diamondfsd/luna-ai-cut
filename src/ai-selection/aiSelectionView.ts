import type { AiSelectionItem, AiSelectionSession, AiSelectionState } from '../shared/types'

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

export function aiSelectionAnalysisProgress(session: AiSelectionSession | null): { phaseCompleted: number; phaseTotal: number; overallCompleted: number; overallTotal: number } {
  if (!session) return { phaseCompleted: 0, phaseTotal: 0, overallCompleted: 0, overallTotal: 0 }
  const photos = session.items.filter((item) => item.kind === 'image')
  const contentCompleted = photos.filter((item) => item.analysisState === 'failed' || Boolean(item.contentTagVersion || item.contentTagError)).length
  const peopleCompleted = session.items.filter((item) => item.analysisState === 'failed' || Boolean(item.personEvidence) || item.semanticTags.includes('人物分析未完成')).length
  const phase = session.phase === 'content'
    ? { completed: contentCompleted, total: photos.length }
    : session.phase === 'people'
      ? { completed: peopleCompleted, total: session.items.length }
      : { completed: session.counts.completed, total: session.counts.total }
  return {
    phaseCompleted: phase.completed,
    phaseTotal: phase.total,
    overallCompleted: session.counts.completed + contentCompleted + peopleCompleted,
    overallTotal: session.counts.total + photos.length + session.items.length,
  }
}
