import { z } from 'zod'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { useFillerRemovalDialogStore } from '@freecut/features/timeline/stores/filler-removal-dialog-store'
import { useSilenceRemovalDialogStore } from '@freecut/features/timeline/stores/silence-removal-dialog-store'
import { analyzeFillerWordsForItems } from '@freecut/features/timeline/utils/filler-word-removal-preview'
import { analyzeSilenceForItems } from '@freecut/features/timeline/utils/silence-removal-preview'
import type { AiEditingTool, AiEditingToolValidation } from './types'

type JsonSchema = AiEditingTool['inputSchema']

function objectSchema(properties: Record<string, unknown>, required?: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function validate<S extends z.ZodType>(schema: S, value: unknown): AiEditingToolValidation {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
  return { ok: false, error: result.error.issues[0]?.message ?? '参数无效。' }
}

function resolveTimelineMediaItemIds(clipIds?: string[]): string[] {
  const requested = clipIds ? new Set(clipIds) : null
  return useTimelineStore.getState().items
    .filter((item) => !requested || requested.has(item.id))
    .filter((item) => (item.type === 'video' || item.type === 'audio') && Boolean(item.mediaId))
    .map((item) => item.id)
}

const cleanupArgs = z.object({ clipIds: z.array(z.string()).min(1).optional() })
const cleanupSchema = objectSchema({
  clipIds: { type: 'array', items: { type: 'string' }, description: '可选的时间轴片段 ID；省略时处理全部音视频片段。' },
})

export const removeSilenceTool: AiEditingTool = {
  id: 'timeline.remove_silence',
  title: '删除静音片段',
  description: '使用本地音频检测找出并直接删除时间轴片段中的静音段。默认使用当前静音处理设置。',
  risk: 'edit',
  execution: 'async',
  inputSchema: cleanupSchema,
  validate: (value) => validate(cleanupArgs, value),
  summarize: (args) => Array.isArray(args.clipIds)
    ? `删除 ${args.clipIds.length} 个片段中的静音`
    : '删除时间轴中的静音片段',
  execute: async (args) => {
    const itemIds = resolveTimelineMediaItemIds(args.clipIds as string[] | undefined)
    if (itemIds.length === 0) return { ok: false, message: '没有可处理的音视频片段。' }
    const analysis = await analyzeSilenceForItems(itemIds, useSilenceRemovalDialogStore.getState().settings)
    const result = useTimelineStore.getState().removeSilenceFromItems(itemIds, analysis.rangesByMediaId)
    return {
      ok: result.removedRangeCount > 0,
      message: result.removedRangeCount > 0
        ? `已删除 ${result.removedRangeCount} 段静音。`
        : '没有找到可删除的静音片段。',
      data: { analyzedItemCount: result.analyzedItemCount, removedRangeCount: result.removedRangeCount },
    }
  },
}

export const removeFillersTool: AiEditingTool = {
  id: 'timeline.remove_fillers',
  title: '删除语气词',
  description: '使用本地字幕时间戳找出并直接删除时间轴中的语气词。默认使用当前语气词处理设置。',
  risk: 'edit',
  execution: 'async',
  inputSchema: cleanupSchema,
  validate: (value) => validate(cleanupArgs, value),
  summarize: (args) => Array.isArray(args.clipIds)
    ? `删除 ${args.clipIds.length} 个片段中的语气词`
    : '删除时间轴中的语气词',
  execute: async (args) => {
    const itemIds = resolveTimelineMediaItemIds(args.clipIds as string[] | undefined)
    if (itemIds.length === 0) return { ok: false, message: '没有可处理的音视频片段。' }
    const rangesByMediaId = await analyzeFillerWordsForItems(itemIds, useFillerRemovalDialogStore.getState().settings)
    const result = useTimelineStore.getState().removeFillerWordsFromItems(itemIds, rangesByMediaId)
    return {
      ok: result.removedRangeCount > 0,
      message: result.removedRangeCount > 0
        ? `已删除 ${result.removedRangeCount} 处语气词。`
        : '没有找到可删除的语气词。',
      data: { analyzedItemCount: result.analyzedItemCount, removedRangeCount: result.removedRangeCount },
    }
  },
}
