import type { AiSelectionItem } from '../../../src/shared/types'
import type { StoredAiSelectionSession } from './aiSelectionSessionSnapshot'

export function prepareAiSelectionReanalysis(session: StoredAiSelectionSession): void {
  session.forceReanalysis = true
  session.status = 'queued'
  session.phase = 'indexing'
  session.error = null
  session.items = session.items.map((item) => {
    const reset: AiSelectionItem = {
      ...item,
      analysisState: 'pending',
      exactHash: null,
      perceptualHash: null,
      luminanceHistogram: null,
      visualSignature: null,
      imageEmbedding: null,
      embeddingVersion: null,
      embeddingError: null,
      quality: null,
      personEvidence: null,
      compositionEvidence: null,
      videoKeyframes: [],
      semanticTags: [item.kind === 'image' ? '照片' : '视频', '等待分析'],
      contentTags: [],
      contentTagVersion: null,
      contentTagError: null,
      sceneId: null,
      groupId: null,
      recommendationScore: 0,
      recommendationReason: null,
      state: 'undecided',
      decisionSource: 'ai',
      flags: { aiRecommended: false, lowQuality: false, duplicate: false, closedEyes: false, analysisFailed: false },
      error: null,
    }
    if (item.decisionSource === 'user') {
      reset.state = item.state
      reset.decisionSource = 'user'
    }
    reset.videoSegments = item.videoSegments.filter((segment) => segment.decisionSource === 'user')
    return reset
  })
}

export function preserveAiSelectionUserDecisions(previous: AiSelectionItem, analyzed: AiSelectionItem): AiSelectionItem {
  if (previous.decisionSource === 'user') {
    analyzed.state = previous.state
    analyzed.decisionSource = 'user'
  }
  const segmentDecisions = new Map(previous.videoSegments.filter((segment) => segment.decisionSource === 'user').map((segment) => [segment.id, segment]))
  analyzed.videoSegments = analyzed.videoSegments.map((segment) => segmentDecisions.get(segment.id) ?? segment)
  return analyzed
}
