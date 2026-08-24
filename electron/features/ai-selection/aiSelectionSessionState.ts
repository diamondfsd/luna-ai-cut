import type { AiSelectionItem, AiSelectionSession } from '../../../src/shared/types'

export function refreshAiSelectionCounts(session: AiSelectionSession): void {
  const attention = (item: AiSelectionItem): boolean => item.flags.lowQuality || item.flags.closedEyes || item.flags.analysisFailed
  session.counts = {
    total: session.counts.total,
    completed: session.items.filter((item) => item.analysisState !== 'pending').length,
    failed: session.items.filter((item) => Boolean(item.error)).length,
    recommended: session.items.filter((item) => item.flags.aiRecommended
      ?? (item.state === 'recommended' || (item.state === 'kept' && Boolean(item.recommendationReason) && item.recommendationReason !== '相似组备选'))).length,
    attention: session.items.filter(attention).length,
    kept: session.items.filter((item) => item.state === 'kept').length,
    rejected: session.items.filter((item) => item.state === 'rejected').length,
    undecided: session.items.filter((item) => item.state === 'undecided').length,
  }
}
