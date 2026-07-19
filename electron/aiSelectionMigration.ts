import type { AiSelectionItem } from '../src/shared/types'
import { refreshBasicSemanticTags } from './aiSelectionTags'

export function normalizeAiSelectionItem(item: AiSelectionItem): void {
  item.analysisState ??= item.error ? 'failed' : 'ready'
  item.recommendationReason ??= null
  item.visualSignature ??= null
  item.personEvidence ??= null
  if (item.personEvidence) {
    item.personEvidence.faceCount ??= 0
    item.personEvidence.primaryFaceBounds ??= null
    item.personEvidence.faceVisibility ??= 'unknown'
    item.personEvidence.eyeState ??= 'unknown'
    item.personEvidence.closedEyeConfidence ??= null
  }
  item.videoKeyframes ??= []
  item.videoKeyframes.forEach((frame) => {
    frame.semanticTags ??= []
    frame.changeScore ??= null
  })
  item.videoSegments ??= []
  item.semanticTags ??= [item.kind === 'image' ? '照片' : '视频']
  refreshBasicSemanticTags(item)
}
