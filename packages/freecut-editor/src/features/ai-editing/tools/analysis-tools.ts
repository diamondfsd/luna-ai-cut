import { z } from 'zod'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { mediaTranscriptionService } from '@freecut/features/media-library/services/media-transcription-service'
import { runMediaTranscriptionJob } from '@freecut/features/media-library/services/media-transcription-runner'
import { importMediaAnalysisService } from '@freecut/features/media-library/services/media-analysis-service-loader'
import { useSettingsStore } from '@freecut/features/editor/deps/settings'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type { MediaTranscript } from '@freecut/types/storage'
import { saveVisualEditingEvidence } from '@freecut/infrastructure/storage'
import { findTranscriptEvidence } from '../evidence'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'
import { mediaIdsFromToolInput } from './media-reference'

const DEFAULT_TRANSCRIPT_PAGE_SIZE = 60
const MAX_TRANSCRIPT_PAGE_SIZE = 60
const MAX_TRANSCRIPT_PAGE_CHARS = 8_000

interface TranscriptPageEntry {
  mediaRef: string
  startSeconds: number
  endSeconds: number
  text: string
}

export function paginateTranscriptEntries(
  entries: readonly TranscriptPageEntry[],
  cursor = 0,
  limit = DEFAULT_TRANSCRIPT_PAGE_SIZE,
): { segments: TranscriptPageEntry[]; nextCursor: number | null } {
  const segments: TranscriptPageEntry[] = []
  let chars = 0
  for (const entry of entries.slice(cursor)) {
    if (segments.length >= limit) break
    if (segments.length > 0 && chars + entry.text.length > MAX_TRANSCRIPT_PAGE_CHARS) break
    segments.push(entry)
    chars += entry.text.length
  }
  const nextCursor = cursor + segments.length
  return { segments, nextCursor: nextCursor < entries.length ? nextCursor : null }
}

async function readTranscriptPage(
  mediaIds: readonly string[],
  cursor = 0,
  limit = DEFAULT_TRANSCRIPT_PAGE_SIZE,
): Promise<{
  cursor: number
  nextCursor: number | null
  totalSegments: number
  missingMediaIds: string[]
  segments: Array<{
    mediaRef: string
    startSeconds: number
    endSeconds: number
    text: string
  }>
}> {
  const entries: TranscriptPageEntry[] = []
  const missingMediaIds: string[] = []
  for (const mediaId of mediaIds) {
    const transcript = await mediaTranscriptionService.getTranscript(mediaId).catch(() => undefined)
    if (!transcript) {
      missingMediaIds.push(mediaId)
      continue
    }
    for (const segment of transcript.segments) {
      const text = segment.text.trim()
      if (!text) continue
      entries.push({
        mediaRef: `media:${mediaId}`,
        startSeconds: segment.start,
        endSeconds: segment.end,
        text,
      })
    }
  }

  const page = paginateTranscriptEntries(entries, cursor, limit)
  return {
    cursor,
    nextCursor: page.nextCursor,
    totalSegments: entries.length,
    missingMediaIds,
    segments: page.segments,
  }
}

const searchTranscript = defineAiEditingTool({
  id: 'analysis.search_transcript',
  title: '查找口播内容',
  description: '按已经知道的明确原话查找时间点。不要用它猜词或遍历字幕；理解完整口播请读取字幕。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      query: { type: 'string', description: '要查找的词或短语。' },
      mediaIds: {
        type: 'array',
        items: { type: 'string' },
        description: '可选的素材范围，使用 media.list 返回的 id。',
      },
    },
    ['query'],
  ),
  schema: z.object({ query: z.string().trim().min(1), mediaIds: z.array(z.string()).optional() }),
  summarize: (args) => `查找口播“${args.query}”`,
  execute: async (args) => {
    const matches = await findTranscriptEvidence(
      args.query,
      args.mediaIds ? mediaIdsFromToolInput(args.mediaIds) : undefined,
    )
    return {
      ok: true,
      message:
        matches.length > 0
          ? `找到 ${matches.length} 处口播内容。`
          : `未在已识别口播中匹配“${args.query}”；这不代表素材没有口播。`,
      data: matches,
    }
  },
})

const readTranscript = defineAiEditingTool({
  id: 'analysis.read_transcript',
  title: '读取素材口播',
  description: '按素材读取完整的带时间口播，可分页。用于理解实际内容和编写脚本。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      mediaIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要读取口播的素材，使用 media.list 返回的 id。',
      },
      cursor: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_TRANSCRIPT_PAGE_SIZE },
    },
    ['mediaIds'],
  ),
  schema: z.object({
    mediaIds: z.array(z.string()).min(1),
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(MAX_TRANSCRIPT_PAGE_SIZE).optional(),
  }),
  summarize: (args) => `读取 ${args.mediaIds.length} 个素材的口播`,
  execute: async (args) => {
    const mediaIds = mediaIdsFromToolInput(args.mediaIds)
    const page = await readTranscriptPage(mediaIds, args.cursor, args.limit)
    return {
      ok: page.segments.length > 0,
      message: page.segments.length > 0
        ? `已读取 ${page.segments.length}/${page.totalSegments} 段实际口播。`
        : '这些素材还没有可读取的口播内容。',
      data: page,
    }
  },
})

const requestAnalysis = defineAiEditingTool({
  id: 'analysis.request',
  title: '分析素材',
  description: '使用本地模型生成字幕识别或画面描述。分析完成后才会提供给剪辑助手。',
  risk: 'analysis',
  inputSchema: objectSchema(
    {
      mediaIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要分析的素材，使用 media.list 返回的 id。',
      },
      kind: { type: 'string', enum: ['transcript', 'visual'] },
    },
    ['mediaIds', 'kind'],
  ),
  schema: z.object({
    mediaIds: z.array(z.string()).min(1),
    kind: z.enum(['transcript', 'visual']),
  }),
  summarize: (args) =>
    `分析 ${args.mediaIds.length} 个素材的${args.kind === 'transcript' ? '口播内容' : '画面内容'}`,
  execute: async (args, context) => {
    const mediaById = useMediaLibraryStore.getState().mediaById
    const media = mediaIdsFromToolInput(args.mediaIds)
      .map((id) => mediaById[id])
      .filter((item) => item !== undefined)
    if (media.length === 0) return { ok: false, message: '没有找到要分析的素材。' }

    const reportItemProgress = (
      index: number,
      total: number,
      itemName: string,
      label: string,
      percent: number | null,
    ): void => {
      context?.reportProgress({
        label: `${label} · ${itemName}（${index + 1}/${total}）`,
        percent: ((index + (percent ?? 0) / 100) / total) * 100,
      })
    }

    if (args.kind === 'transcript') {
      const eligibleMedia = media.filter(
        (item) => item.mimeType.startsWith('audio/') || item.mimeType.startsWith('video/'),
      )
      if (eligibleMedia.length === 0) return { ok: false, message: '没有可识别口播的素材。' }
      const host = getEmbeddedHostBridge()
      if (host.transcribeMedia) {
        let completed = 0
        for (const [index, item] of eligibleMedia.entries()) {
          context?.signal?.throwIfAborted()
          reportItemProgress(index, eligibleMedia.length, item.fileName, '正在准备口播识别', 0)
          useMediaLibraryStore.getState().setTranscriptStatus(item.id, 'transcribing')
          try {
            const result = await host.transcribeMedia(
              {
                mediaId: item.id,
                nativePath: item.nativePath,
                fileName: item.fileName,
                fileSize: item.fileSize,
                fileLastModified: item.fileLastModified,
                mimeType: item.mimeType,
                durationSeconds: item.duration,
              },
              (progress) =>
                reportItemProgress(
                  index,
                  eligibleMedia.length,
                  item.fileName,
                  progress.label,
                  progress.percent,
                ),
            )
            const now = Date.now()
            const transcript: MediaTranscript = {
              id: item.id,
              mediaId: item.id,
              // Kept for compatibility with the existing caption UI. Actual
              // model provenance is recorded below and shown to the AI.
              model: 'parakeet-tdt-v3',
              language: result.language,
              quantization: 'hybrid',
              text: result.cues.map((cue) => cue.text).join(' '),
              segments: result.cues.map((cue) => ({
                text: cue.text,
                start: cue.startSeconds,
                end: cue.endSeconds,
              })),
              createdAt: now,
              updatedAt: now,
              provenance: {
                service: 'luna-subtitle-service',
                modelId: result.model.id,
                modelVersion: result.model.version,
                sourceFingerprint: `${result.sourceFingerprint.size}:${result.sourceFingerprint.modifiedAtMs}`,
              },
            }
            await mediaTranscriptionService.adoptTranscript(transcript)
            useMediaLibraryStore.getState().setTranscriptStatus(item.id, 'ready')
            completed += 1
            reportItemProgress(index, eligibleMedia.length, item.fileName, '口播识别完成', 100)
          } catch (error) {
            useMediaLibraryStore.getState().setTranscriptStatus(item.id, 'error')
            throw error
          }
        }
        return {
          ok: completed > 0,
          message:
            completed > 0 ? `已完成 ${completed} 个素材的本地口播识别。` : '没有可识别口播的素材。',
          ...(completed > 0
            ? {
                data: {
                  transcript: await readTranscriptPage(eligibleMedia.map((item) => item.id)),
                },
              }
            : {}),
        }
      }

      for (const [index, item] of eligibleMedia.entries()) {
        context?.signal?.throwIfAborted()
        await runMediaTranscriptionJob(item.id, {
          onProgress: (progress) =>
            reportItemProgress(
              index,
              eligibleMedia.length,
              item.fileName,
              '正在识别口播',
              progress.progress * 100,
            ),
        })
        reportItemProgress(index, eligibleMedia.length, item.fileName, '口播识别完成', 100)
      }
      return {
        ok: true,
        message: '口播识别已完成，并已附带实际口播内容。',
        data: { transcript: await readTranscriptPage(eligibleMedia.map((item) => item.id)) },
      }
    }

    const eligibleMedia = media.filter(
      (item) => item.mimeType.startsWith('video/') || item.mimeType.startsWith('image/'),
    )
    if (eligibleMedia.length === 0) return { ok: false, message: '没有可分析画面的素材。' }
    const host = getEmbeddedHostBridge()
    if (host.analyzeMediaVisual) {
      const intensity = useSettingsStore.getState().visualAnalysisIntensity
      let analyzed = 0
      let withEvidence = 0
      for (const [index, item] of eligibleMedia.entries()) {
        context?.signal?.throwIfAborted()
        reportItemProgress(index, eligibleMedia.length, item.fileName, '正在准备画面理解', 0)
        const result = await host.analyzeMediaVisual(
          {
            mediaId: item.id,
            nativePath: item.nativePath,
            fileName: item.fileName,
            fileSize: item.fileSize,
            fileLastModified: item.fileLastModified,
            mimeType: item.mimeType,
            durationSeconds: item.duration,
          },
          intensity,
          (progress) =>
            reportItemProgress(
              index,
              eligibleMedia.length,
              item.fileName,
              progress.label,
              progress.percent,
            ),
        )
        const sourceFingerprint =
          item.contentHash ?? `${item.fileSize}:${item.fileLastModified ?? item.updatedAt}`
        await saveVisualEditingEvidence(item.id, sourceFingerprint, {
          samples: result.samples,
          models: result.models,
          intensity: result.intensity,
        })
        analyzed += 1
        if (result.samples.length > 0) withEvidence += 1
        reportItemProgress(
          index,
          eligibleMedia.length,
          item.fileName,
          result.samples.length > 0 ? '画面理解完成' : '画面理解未产生结果',
          100,
        )
      }
      return {
        ok: withEvidence > 0,
        message:
          withEvidence > 0
            ? `已分析 ${analyzed} 个素材，其中 ${withEvidence} 个产生了可用画面描述。`
            : `已尝试分析 ${analyzed} 个素材，但没有产生可用画面描述。`,
        data: {
          analyzed,
          withEvidence,
          withoutEvidence: analyzed - withEvidence,
        },
      }
    }

    const { mediaAnalysisService } = await importMediaAnalysisService()
    let completed = 0
    for (const [index, item] of eligibleMedia.entries()) {
      context?.signal?.throwIfAborted()
      reportItemProgress(index, eligibleMedia.length, item.fileName, '正在理解画面', null)
      if (await mediaAnalysisService.analyzeMedia(item)) completed += 1
      reportItemProgress(index, eligibleMedia.length, item.fileName, '画面理解完成', 100)
    }
    return {
      ok: completed > 0,
      message:
        completed > 0 ? `已完成 ${completed} 个素材的画面分析。` : '没有完成可用的画面分析。',
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [searchTranscript, readTranscript, requestAnalysis],
}
