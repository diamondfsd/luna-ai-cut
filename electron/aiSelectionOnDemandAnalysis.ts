import * as path from 'node:path'

import type { AiSelectionItem, AiSelectionSession } from '../src/shared/types'
import { analyzePersonEvidence } from './aiSelectionPerson'
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

export async function analyzePeopleOnDemand(context: AiSelectionAnalysisContext, itemIds: string[]): Promise<void> {
  const targets = [...new Set(itemIds)].map((itemId) => context.session.items.find((item) => item.id === itemId))
    .filter((item): item is AiSelectionItem => Boolean(item && item.analysisState === 'ready'))
  if (targets.length === 0) throw new Error('没有可进行人物分析的素材')
  const controller = new AbortController()
  try {
    for (const item of targets) {
      item.personEvidence = await analyzePersonEvidence(item, controller.signal)
      const evidenceTags = item.personEvidence.detected ? ['人物', '人像', '主体'] : ['无人像']
      if (item.personEvidence.faceCount > 0) evidenceTags.push('人脸')
      if (item.personEvidence.eyeState === 'closed') evidenceTags.push('闭眼', '建议复查')
      if (item.personEvidence.eyeState === 'mixed') evidenceTags.push('眨眼', '建议复查')
      if (item.personEvidence.faceVisibility === 'occluded') evidenceTags.push('面部遮挡', '建议复查')
      item.semanticTags = [...new Set([...item.semanticTags, ...evidenceTags])]
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
        const previousTags = new Set(item.contentTags)
        item.semanticTags = item.semanticTags.filter((tag) => !previousTags.has(tag))
        item.contentTags = await analyzeContentTags(item, controller.signal)
        item.contentTagVersion = CONTENT_TAG_VERSION
        item.contentTagError = null
        item.semanticTags = [...new Set([...item.semanticTags, ...item.contentTags])]
        refreshBasicSemanticTags(item)
        await context.writeCachedItem(item)
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
