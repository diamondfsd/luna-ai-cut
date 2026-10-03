import type { AiSelectionItem, AiSelectionSession } from '../../../src/shared/types'
import { COMPOSITION_ANALYSIS_VERSION, type CompositionEvidence } from '../../../src/shared/compositionAnalysis'
import { analyzePersonEvidence } from './aiSelectionPerson'
import { FACE_EMBEDDING_VERSION } from './aiSelectionFaceGroups'
import { analyzeContentTags, CONTENT_TAG_VERSION } from './aiSelectionSemantic'
import { refreshBasicSemanticTags } from './aiSelectionTags'
import { shutdownSpecializedSegmentationWorker } from '../segmentation/specializedSegmentationService'
import { analyzeCompositionSubject } from '../composition/compositionAnalysisService'
import { reportEvidenceResult } from './aiSelectionEvidenceProgress'

export interface AiSelectionAnalysisContext {
  session: AiSelectionSession
  cacheRoot: string
  writeCachedItem: (item: AiSelectionItem) => Promise<void>
  update: (label?: string | null) => Promise<void>
  rebuild: () => void
  reportProgress: (label: string) => void
}

async function applyPersonEvidence(item: AiSelectionItem, evidence: Awaited<ReturnType<typeof analyzePersonEvidence>>): Promise<void> {
  item.personEvidence = evidence
  if (item.compositionEvidence?.source === 'person') item.compositionEvidence = null
  const evidenceTags = evidence.detected ? ['人物', '人像', '主体'] : ['无人像']
  if (evidence.faceCount > 0) evidenceTags.push('人脸')
  if (evidence.eyeState === 'closed') evidenceTags.push('闭眼', '建议复查')
  if (evidence.faceVisibility === 'occluded') evidenceTags.push('面部遮挡', '建议复查')
  item.semanticTags = [...new Set([...item.semanticTags, ...evidenceTags])]
  refreshBasicSemanticTags(item)
}

async function analyzePersonItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  const evidence = await analyzePersonEvidence(item, signal)
  await applyPersonEvidence(item, evidence)
  await context.writeCachedItem(item)
  context.rebuild()
}

function failedCompositionEvidence(reason: string): CompositionEvidence {
  return {
    version: COMPOSITION_ANALYSIS_VERSION,
    source: 'relic2-cpc',
    detected: false,
    confidence: 0,
    coverage: 0,
    bounds: null,
    score: { raw: null, normalized: 0.5 },
    reason,
  }
}

async function analyzeContentItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  const previousTags = new Set(item.contentTags)
  item.semanticTags = item.semanticTags.filter((tag) => !previousTags.has(tag))
  item.contentTags = await analyzeContentTags(item, signal)
  item.contentTagVersion = CONTENT_TAG_VERSION
  item.contentTagError = null
  item.semanticTags = [...new Set([...item.semanticTags, ...item.contentTags])]
  refreshBasicSemanticTags(item)
  await context.writeCachedItem(item)
  context.rebuild()
}

export async function analyzePeopleOnDemand(context: AiSelectionAnalysisContext, itemIds: string[]): Promise<void> {
  const targets = [...new Set(itemIds)].map((itemId) => context.session.items.find((item) => item.id === itemId))
    .filter((item): item is AiSelectionItem => Boolean(item && item.kind === 'image' && item.analysisState === 'ready'))
  if (targets.length === 0) return
  const controller = new AbortController()
  try {
    for (const item of targets) {
      try {
        await analyzePersonItem(context, item, controller.signal)
      } catch {
        item.semanticTags = [...new Set([...item.semanticTags, '人物分析未完成'])]
      }
      await context.update(item.name)
    }
  } finally {
    shutdownSpecializedSegmentationWorker()
  }
  context.rebuild()
  await context.update()
}

export async function analyzeContentOnDemand(context: AiSelectionAnalysisContext, itemIds: string[]): Promise<void> {
  const requested = itemIds.length > 0 ? new Set(itemIds) : null
  const targets = context.session.items.filter((item) => item.kind === 'image'
    && item.analysisState === 'ready'
    && (!requested || requested.has(item.id))
    && item.contentTagVersion !== CONTENT_TAG_VERSION)
  const controller = new AbortController()
  try {
    for (const item of targets) {
      try {
        await analyzeContentItem(context, item, controller.signal)
      } catch (error) {
        item.contentTagError = error instanceof Error ? error.message : String(error)
      }
      await context.update(item.name)
    }
  } finally {
    shutdownSpecializedSegmentationWorker()
  }
  context.rebuild()
  await context.update()
}

export async function analyzeRecommendationEvidence(context: AiSelectionAnalysisContext, itemIds: string[], signal?: AbortSignal): Promise<void> {
  const requested = new Set(itemIds)
  const targets = context.session.items.filter((item) => {
    if (item.kind !== 'image' || !requested.has(item.id) || item.analysisState !== 'ready') return false
    const needsPeople = !item.personEvidence || (item.personEvidence.faces?.some((face) => face.embedding && face.embeddingVersion !== FACE_EMBEDDING_VERSION) ?? false)
    return item.contentTagVersion !== CONTENT_TAG_VERSION || needsPeople || item.compositionEvidence?.version !== COMPOSITION_ANALYSIS_VERSION
  })
  if (targets.length === 0) return
  try {
    context.session.phase = 'evidence'
    await context.update()
    // Each item finishes its evidence set atomically, while independent analyses
    // for the same asset run concurrently.
    const concurrency = 2
    for (let offset = 0; offset < targets.length; offset += concurrency) {
      signal?.throwIfAborted()
      const batch = targets.slice(offset, offset + concurrency)
      await Promise.all(batch.map(async (item) => {
        try {
          await analyzePhotoEvidenceItem(context, item, signal)
        } catch (error) {
          signal?.throwIfAborted()
          item.semanticTags = [...new Set([...item.semanticTags, item.kind === 'video' ? '人物分析未完成' : '画面分析未完成'])]
          await context.writeCachedItem(item)
        }
      }))
      context.rebuild()
      await context.update(batch[batch.length - 1]?.name ?? null)
    }
  } finally {
    shutdownSpecializedSegmentationWorker()
  }
  context.rebuild()
  await context.update()
}

async function analyzePhotoEvidenceItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  const previousContentTags = new Set(item.contentTags)
  const needsContent = item.contentTagVersion !== CONTENT_TAG_VERSION
  const needsPeople = !item.personEvidence || (item.personEvidence.faces?.some((face) => face.embedding && face.embeddingVersion !== FACE_EMBEDDING_VERSION) ?? false)
  const needsComposition = item.compositionEvidence?.version !== COMPOSITION_ANALYSIS_VERSION
  const report = () => context.reportProgress(item.name)
  await Promise.allSettled([
    needsContent ? reportEvidenceResult(analyzeContentTags(item, signal), (tags) => {
      item.semanticTags = item.semanticTags.filter((tag) => !previousContentTags.has(tag))
      item.contentTags = tags
      item.contentTagVersion = CONTENT_TAG_VERSION
      item.contentTagError = null
      item.semanticTags = [...new Set([...item.semanticTags, ...tags])]
    }, (error) => { item.contentTagError = error instanceof Error ? error.message : String(error) }, report, signal) : Promise.resolve(),
    needsPeople ? reportEvidenceResult(analyzePersonEvidence(item, signal), (evidence) => applyPersonEvidence(item, evidence), () => {
      item.semanticTags = [...new Set([...item.semanticTags, '人物分析未完成'])]
    }, report, signal) : Promise.resolve(),
    needsComposition ? reportEvidenceResult(analyzeCompositionSubject(item.path, undefined, signal), (evidence) => {
      item.compositionEvidence = evidence
    }, () => { item.compositionEvidence = failedCompositionEvidence('构图分析暂不可用') }, report, signal) : Promise.resolve(),
  ])
  signal?.throwIfAborted()
  refreshBasicSemanticTags(item)
  await context.writeCachedItem(item)
}
