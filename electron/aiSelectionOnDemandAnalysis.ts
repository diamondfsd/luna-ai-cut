import * as path from 'node:path'

import type { AiSelectionItem, AiSelectionSession } from '../src/shared/types'
import { analyzePersonEvidence, analyzeVideoPeopleEvidence } from './aiSelectionPerson'
import { FACE_EMBEDDING_VERSION } from './aiSelectionFaceGroups'
import { ensureVideoFaceFrames } from './aiSelectionVideoFaceFrames'
import { analyzeContentTags, CONTENT_TAG_VERSION } from './aiSelectionSemantic'
import { refreshBasicSemanticTags } from './aiSelectionTags'
import { analyzeVideoStory } from './aiSelectionVideo'
import { shutdownSpecializedSegmentationWorker } from './specializedSegmentationService'

export interface AiSelectionAnalysisContext {
  session: AiSelectionSession
  cacheRoot: string
  writeCachedItem: (item: AiSelectionItem) => Promise<void>
  update: (label?: string | null) => Promise<void>
  rebuild: () => void
}

async function analyzePersonItem(context: AiSelectionAnalysisContext, item: AiSelectionItem, signal?: AbortSignal): Promise<void> {
  item.personEvidence = item.kind === 'video'
    ? await analyzeVideoPeopleEvidence(item, signal)
    : await analyzePersonEvidence(item, signal)
  if (item.kind === 'video') await ensureVideoFaceFrames(item, context.cacheRoot, undefined, signal)
  const evidenceTags = item.personEvidence.detected ? ['人物', '人像', '主体'] : ['无人像']
  if (item.personEvidence.faceCount > 0) evidenceTags.push('人脸')
  if (item.personEvidence.eyeState === 'closed') evidenceTags.push('闭眼', '建议复查')
  if (item.personEvidence.faceVisibility === 'occluded') evidenceTags.push('面部遮挡', '建议复查')
  item.semanticTags = [...new Set([...item.semanticTags, ...evidenceTags])]
  refreshBasicSemanticTags(item)
  await context.writeCachedItem(item)
  context.rebuild()
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
        // 视频人物识别是尽力而为，不影响视频进入拍摄时段和任务完成。
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
  const photos = context.session.items.filter((item) => requested.has(item.id) && item.kind === 'image' && item.analysisState === 'ready')
  if (photos.length === 0) return
  try {
    const contentTargets = photos.filter((item) => item.contentTagVersion !== CONTENT_TAG_VERSION)
    if (contentTargets.length > 0) {
      context.session.phase = 'content'
      await context.update()
      for (const item of contentTargets) {
        signal?.throwIfAborted()
        try {
          await analyzeContentItem(context, item, signal)
        } catch (error) {
          signal?.throwIfAborted()
          item.contentTagError = error instanceof Error ? error.message : String(error)
        }
        await context.update(item.name)
      }
    }

    const peopleTargets = photos.filter((item) => {
      if (!item.personEvidence) return true
      return item.personEvidence.faces?.some((face) => (
        face.embedding && face.embeddingVersion !== FACE_EMBEDDING_VERSION
      )) ?? false
    })
    if (peopleTargets.length > 0) {
      context.session.phase = 'people'
      await context.update()
      for (const item of peopleTargets) {
        signal?.throwIfAborted()
        try {
          await analyzePersonItem(context, item, signal)
        } catch (error) {
          signal?.throwIfAborted()
          item.semanticTags = [...new Set([...item.semanticTags, '人物分析未完成'])]
        }
        await context.update(item.name)
      }
    }
  } finally {
    shutdownSpecializedSegmentationWorker()
  }
  context.rebuild()
  await context.update()
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
