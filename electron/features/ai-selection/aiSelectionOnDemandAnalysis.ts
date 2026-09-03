import * as path from 'node:path'

import type { AiSelectionItem, AiSelectionSession } from '../../../src/shared/types'
import { COMPOSITION_ANALYSIS_VERSION, type CompositionEvidence } from '../../../src/shared/compositionAnalysis'
import { analyzePersonEvidence, analyzeVideoPeopleEvidence } from './aiSelectionPerson'
import { FACE_EMBEDDING_VERSION } from './aiSelectionFaceGroups'
import { ensureVideoFaceFrames } from './aiSelectionVideoFaceFrames'
import { analyzeContentTags, CONTENT_TAG_VERSION } from './aiSelectionSemantic'
import { refreshBasicSemanticTags } from './aiSelectionTags'
import { analyzeVideoStory } from './aiSelectionVideo'
import { shutdownSpecializedSegmentationWorker } from '../segmentation/specializedSegmentationService'
import { analyzeCompositionSubject } from '../composition/compositionAnalysisService'

export interface AiSelectionAnalysisContext {
  session: AiSelectionSession
  cacheRoot: string
  writeCachedItem: (item: AiSelectionItem) => Promise<void>
  update: (label?: string | null) => Promise<void>
  rebuild: () => void
}

async function detectPersonEvidence(item: AiSelectionItem, signal?: AbortSignal) {
  return item.kind === 'video'
    ? analyzeVideoPeopleEvidence(item, signal)
    : analyzePersonEvidence(item, signal)
}

async function applyPersonEvidence(context: AiSelectionAnalysisContext, item: AiSelectionItem, evidence: Awaited<ReturnType<typeof detectPersonEvidence>>, signal?: AbortSignal): Promise<void> {
  item.personEvidence = evidence
  if (item.compositionEvidence?.source === 'person') item.compositionEvidence = null
  if (item.kind === 'video') await ensureVideoFaceFrames(item, context.cacheRoot, undefined, signal)
  const evidenceTags = evidence.detected ? ['人物', '人像', '主体'] : ['无人像']
  if (evidence.faceCount > 0) evidenceTags.push('人脸')
  if (evidence.eyeState === 'closed') evidenceTags.push('闭眼', '建议复查')
  if (evidence.faceVisibility === 'occluded') evidenceTags.push('面部遮挡', '建议复查')
  item.semanticTags = [...new Set([...item.semanticTags, ...evidenceTags])]
  refreshBasicSemanticTags(item)
}

async function analyzePersonItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  const evidence = await detectPersonEvidence(item, signal)
  await applyPersonEvidence(context, item, evidence, signal)
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

function videoCompositionFrameTime(item: AiSelectionItem): number | undefined {
  if (item.kind !== 'video' || !Number.isFinite(item.duration) || (item.duration ?? 0) <= 0.2) return undefined
  const end = Math.max(0.05, (item.duration ?? 1) - 0.05)
  return Number(Math.max(0.05, Math.min(end, (item.duration ?? 1) * 0.5)).toFixed(3))
}

export async function analyzeVideoPeopleOnDemand(
  context: AiSelectionAnalysisContext,
  itemIds: string[],
  signal?: AbortSignal,
): Promise<void> {
  const requested = new Set(itemIds)
  const targets = context.session.items.filter((item) => (
    requested.has(item.id)
    && item.kind === 'video'
    && item.analysisState === 'ready'
    && !item.personEvidence
  ))
  if (targets.length === 0) return
  try {
    context.session.phase = 'people'
    await context.update()
    for (const item of targets) {
      signal?.throwIfAborted()
      try {
        await analyzePersonItem(context, item, signal)
      } catch (error) {
        signal?.throwIfAborted()
        item.semanticTags = [...new Set([...item.semanticTags, '人物分析未完成'])]
      }
      await context.update(item.name)
    }
  } finally {
    shutdownSpecializedSegmentationWorker()
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
    .filter((item): item is AiSelectionItem => Boolean(item && item.analysisState === 'ready'))
  if (targets.length === 0) throw new Error('没有可进行人物分析的素材')
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
    if (!requested.has(item.id) || item.analysisState !== 'ready') return false
    if (item.kind === 'video') return !item.personEvidence || item.compositionEvidence?.version !== COMPOSITION_ANALYSIS_VERSION
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
          await analyzeEvidenceItem(context, item, signal)
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
  const [contentResult, personResult, compositionResult] = await Promise.allSettled([
    needsContent ? analyzeContentTags(item, signal) : Promise.resolve(item.contentTags),
    needsPeople ? analyzePersonEvidence(item, signal) : Promise.resolve(item.personEvidence),
    needsComposition ? analyzeCompositionSubject(item.path, undefined, signal) : Promise.resolve(item.compositionEvidence),
  ])
  signal?.throwIfAborted()

  if (contentResult.status === 'fulfilled' && needsContent) {
    item.semanticTags = item.semanticTags.filter((tag) => !previousContentTags.has(tag))
    item.contentTags = contentResult.value
    item.contentTagVersion = CONTENT_TAG_VERSION
    item.contentTagError = null
    item.semanticTags = [...new Set([...item.semanticTags, ...item.contentTags])]
  } else if (contentResult.status === 'rejected' && needsContent) {
    item.contentTagError = contentResult.reason instanceof Error ? contentResult.reason.message : String(contentResult.reason)
  }

  if (personResult.status === 'fulfilled' && personResult.value) {
    await applyPersonEvidence(context, item, personResult.value, signal)
  } else if (personResult.status === 'rejected' && needsPeople) {
    item.semanticTags = [...new Set([...item.semanticTags, '人物分析未完成'])]
  }

  if (compositionResult.status === 'fulfilled' && compositionResult.value) {
    item.compositionEvidence = compositionResult.value
  } else if (compositionResult.status === 'rejected' && needsComposition) {
    item.compositionEvidence = failedCompositionEvidence('构图分析暂不可用')
  }
  refreshBasicSemanticTags(item)
  await context.writeCachedItem(item)
}

async function analyzeVideoEvidenceItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  const needsPeople = !item.personEvidence
  const needsComposition = item.compositionEvidence?.version !== COMPOSITION_ANALYSIS_VERSION
  const [personResult, compositionResult] = await Promise.allSettled([
    needsPeople ? detectPersonEvidence(item, signal) : Promise.resolve(item.personEvidence),
    needsComposition ? analyzeCompositionSubject(item.path, videoCompositionFrameTime(item), signal) : Promise.resolve(item.compositionEvidence),
  ])
  signal?.throwIfAborted()

  if (personResult.status === 'fulfilled' && personResult.value) {
    await applyPersonEvidence(context, item, personResult.value, signal)
  } else if (personResult.status === 'rejected' && needsPeople) {
    item.semanticTags = [...new Set([...item.semanticTags, '人物分析未完成'])]
  }
  if (compositionResult.status === 'fulfilled' && compositionResult.value) {
    item.compositionEvidence = compositionResult.value
  } else if (compositionResult.status === 'rejected' && needsComposition) {
    item.compositionEvidence = failedCompositionEvidence('构图分析暂不可用')
  }
  refreshBasicSemanticTags(item)
  await context.writeCachedItem(item)
}

async function analyzeEvidenceItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  if (item.kind === 'image') {
    await analyzePhotoEvidenceItem(context, item, signal)
    return
  }
  await analyzeVideoEvidenceItem(context, item, signal)
}

export async function analyzeVideosOnDemand(context: AiSelectionAnalysisContext, itemIds: string[]): Promise<void> {
  const targets = [...new Set(itemIds)].map((itemId) => context.session.items.find((item) => item.id === itemId))
    .filter((item): item is AiSelectionItem => Boolean(item && item.kind === 'video' && item.analysisState === 'ready' && item.duration && item.duration > 0.2))
  if (targets.length === 0) throw new Error('没有可以整理的视频')
  const controller = new AbortController()
  for (const item of targets) {
    if (item.videoKeyframes.length > 0) continue
    const story = await analyzeVideoStory(item, item.duration ?? 1, path.join(context.cacheRoot, 'video-stories'), controller.signal)
    item.videoKeyframes = story.keyframes
    item.videoSegments = story.segments
    const usable = story.segments.filter((segment) => segment.status === 'usable').length
    item.semanticTags = [...new Set([...item.semanticTags, '视频故事板', usable > 0 ? '可用片段' : '建议复查', ...story.keyframes.flatMap((frame) => frame.semanticTags)])]
    item.recommendationReason = usable > 0 ? '已整理出可以快速查看的视频片段' : '这些视频片段建议再看一眼'
    await context.writeCachedItem(item)
    await context.update(item.name)
  }
  context.rebuild()
  await context.update()
}
