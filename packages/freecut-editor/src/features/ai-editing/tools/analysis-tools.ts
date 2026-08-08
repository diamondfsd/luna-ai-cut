import { z } from 'zod'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { mediaTranscriptionService } from '@freecut/features/media-library/services/media-transcription-service'
import { runMediaTranscriptionJob } from '@freecut/features/media-library/services/media-transcription-runner'
import { importMediaAnalysisService } from '@freecut/features/media-library/services/media-analysis-service-loader'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type { MediaTranscript } from '@freecut/types/storage'
import { saveVisualEditingEvidence } from '@freecut/infrastructure/storage'
import { findTranscriptEvidence } from '../evidence'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const searchTranscript = defineAiEditingTool({
  id: 'analysis.search_transcript',
  title: '查找口播内容',
  description: '按说出的词或短语查找时间点。只返回带时间的文字识别结果。',
  risk: 'read',
  inputSchema: objectSchema({
    query: { type: 'string', description: '要查找的词或短语。' },
    mediaIds: { type: 'array', items: { type: 'string' }, description: '可选的素材范围。' },
  }, ['query']),
  schema: z.object({ query: z.string().min(1), mediaIds: z.array(z.string()).optional() }),
  summarize: (args) => `查找口播“${args.query}”`,
  execute: async (args) => {
    const matches = await findTranscriptEvidence(args.query, args.mediaIds)
    return {
      ok: true,
      message: matches.length > 0 ? `找到 ${matches.length} 处口播内容。` : '没有找到对应口播内容。',
      data: matches,
    }
  },
})

const requestAnalysis = defineAiEditingTool({
  id: 'analysis.request',
  title: '分析素材',
  description: '使用本地模型生成字幕识别或画面描述。分析完成后才会提供给剪辑助手。',
  risk: 'analysis',
  inputSchema: objectSchema({
    mediaIds: { type: 'array', items: { type: 'string' }, description: '要分析的素材。' },
    kind: { type: 'string', enum: ['transcript', 'visual'] },
  }, ['mediaIds', 'kind']),
  schema: z.object({
    mediaIds: z.array(z.string()).min(1),
    kind: z.enum(['transcript', 'visual']),
  }),
  summarize: (args) => `分析 ${args.mediaIds.length} 个素材的${args.kind === 'transcript' ? '口播内容' : '画面内容'}`,
  execute: async (args) => {
    const mediaById = useMediaLibraryStore.getState().mediaById
    const media = args.mediaIds.map((id) => mediaById[id]).filter((item) => item !== undefined)
    if (media.length === 0) return { ok: false, message: '没有找到要分析的素材。' }

    if (args.kind === 'transcript') {
      const host = getEmbeddedHostBridge()
      if (host.transcribeMedia) {
        let completed = 0
        for (const item of media) {
          if (!item.mimeType.startsWith('audio/') && !item.mimeType.startsWith('video/')) continue
          useMediaLibraryStore.getState().setTranscriptStatus(item.id, 'transcribing')
          try {
            const result = await host.transcribeMedia({
              mediaId: item.id,
              fileName: item.fileName,
              fileSize: item.fileSize,
              fileLastModified: item.fileLastModified,
              mimeType: item.mimeType,
              durationSeconds: item.duration,
            })
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
          } catch (error) {
            useMediaLibraryStore.getState().setTranscriptStatus(item.id, 'error')
            throw error
          }
        }
        return {
          ok: completed > 0,
          message: completed > 0 ? `已完成 ${completed} 个素材的本地口播识别。` : '没有可识别口播的素材。',
        }
      }

      for (const item of media) {
        if (!item.mimeType.startsWith('audio/') && !item.mimeType.startsWith('video/')) continue
        await runMediaTranscriptionJob(item.id)
      }
      return { ok: true, message: '口播识别已完成。' }
    }

    const host = getEmbeddedHostBridge()
    if (host.analyzeMediaVisual) {
      let completed = 0
      for (const item of media) {
        if (!item.mimeType.startsWith('video/') && !item.mimeType.startsWith('image/')) continue
        const result = await host.analyzeMediaVisual({
          mediaId: item.id,
          fileName: item.fileName,
          fileSize: item.fileSize,
          fileLastModified: item.fileLastModified,
          mimeType: item.mimeType,
          durationSeconds: item.duration,
        })
        const sourceFingerprint = item.contentHash ?? `${item.fileSize}:${item.fileLastModified ?? item.updatedAt}`
        await saveVisualEditingEvidence(item.id, sourceFingerprint, {
          samples: result.samples,
          models: result.models,
        })
        completed += 1
      }
      return {
        ok: completed > 0,
        message: completed > 0 ? `已完成 ${completed} 个素材的本地画面分析。` : '没有可分析画面的素材。',
      }
    }

    const { mediaAnalysisService } = await importMediaAnalysisService()
    const results = await Promise.all(media.map((item) => mediaAnalysisService.analyzeMedia(item)))
    const completed = results.filter(Boolean).length
    return {
      ok: completed > 0,
      message: completed > 0 ? `已完成 ${completed} 个素材的画面分析。` : '没有完成可用的画面分析。',
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [searchTranscript, requestAnalysis],
}
