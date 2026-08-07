import { z } from 'zod'
import { listEditorTools } from '@freecut/features/editor/agent/tools/registry'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { mediaTranscriptionService } from '@freecut/features/media-library/services/media-transcription-service'
import { runMediaTranscriptionJob } from '@freecut/features/media-library/services/media-transcription-runner'
import { importMediaAnalysisService } from '@freecut/features/media-library/services/media-analysis-service-loader'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type { MediaTranscript } from '@freecut/types/storage'
import { saveVisualEditingEvidence } from '@freecut/infrastructure/storage'
import { analyzeAudioBeats, getAudioBeatEvidence } from './audio-beat-service'
import { buildProjectEvidence, findTranscriptEvidence } from './evidence'
import {
  applyAiSettingChanges,
  getAiEditableSettings,
  listAiEditableSettings,
  validateAiSettingChanges,
} from './settings-registry'
import type {
  AiEditingTool,
  AiEditingToolResult,
  AiEditingToolValidation,
} from './types'

type JsonSchema = AiEditingTool['inputSchema']

function objectSchema(properties: Record<string, unknown>, required?: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function zodValidation<S extends z.ZodType>(schema: S, value: unknown): AiEditingToolValidation {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
  const issue = result.error.issues[0]
  return { ok: false, error: issue?.message ?? '参数无效。' }
}

function defineTool<S extends z.ZodType>(definition: {
  id: string
  title: string
  description: string
  risk: AiEditingTool['risk']
  execution?: AiEditingTool['execution']
  inputSchema: JsonSchema
  schema: S
  summarize: (args: z.infer<S>) => string
  execute: (args: z.infer<S>) => Promise<AiEditingToolResult> | AiEditingToolResult
}): AiEditingTool {
  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    risk: definition.risk,
    execution: definition.execution ?? 'sync',
    inputSchema: definition.inputSchema,
    validate: (value) => zodValidation(definition.schema, value),
    summarize: (args) => definition.summarize(args as z.infer<S>),
    execute: (args) => definition.execute(args as z.infer<S>),
  }
}

const inspectProject = defineTool({
  id: 'project.inspect',
  title: '查看剪辑内容',
  description: '读取时间轴和已分析素材的结构化摘要。不会读取或发送原始视频画面。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.object({}),
  summarize: () => '查看当前项目',
  execute: async () => ({ ok: true, message: '已读取项目摘要。', data: await buildProjectEvidence() }),
})

const searchTranscript = defineTool({
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

const requestAnalysis = defineTool({
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

const generateCaptions = defineTool({
  id: 'captions.generate',
  title: '生成字幕',
  description: '把已识别的口播内容生成到时间轴字幕轨道。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({
    mediaId: { type: 'string', description: '已完成口播识别的素材。' },
    clipIds: { type: 'array', items: { type: 'string' }, description: '可选的时间轴片段范围。' },
    replaceExisting: { type: 'boolean', description: '是否替换该素材已有的自动字幕。' },
  }, ['mediaId']),
  schema: z.object({
    mediaId: z.string().min(1),
    clipIds: z.array(z.string()).optional(),
    replaceExisting: z.boolean().optional(),
  }),
  summarize: () => '生成时间轴字幕',
  execute: async (args) => {
    const result = await mediaTranscriptionService.insertTranscriptAsCaptions(args.mediaId, {
      clipIds: args.clipIds,
      replaceExisting: args.replaceExisting ?? true,
      selectUpdatedClips: true,
    })
    return {
      ok: true,
      message: result.insertedItemCount > 0 ? `已生成 ${result.insertedItemCount} 条字幕。` : '当前时间轴范围内没有可生成的字幕。',
      data: result,
    }
  },
})

const inspectBeats = defineTool({
  id: 'audio.inspect_beats',
  title: '查看音乐节拍',
  description: '读取已分析音乐的 BPM 和节拍时间点。',
  risk: 'read',
  inputSchema: objectSchema({
    mediaId: { type: 'string', description: '音乐素材。' },
    startSeconds: { type: 'number', minimum: 0, description: '可选的起始时间。' },
    endSeconds: { type: 'number', minimum: 0, description: '可选的结束时间。' },
  }, ['mediaId']),
  schema: z.object({
    mediaId: z.string().min(1),
    startSeconds: z.number().min(0).optional(),
    endSeconds: z.number().min(0).optional(),
  }),
  summarize: () => '查看音乐节拍',
  execute: (args) => {
    const evidence = getAudioBeatEvidence(args.mediaId)
    if (!evidence) return { ok: false, message: '这段音乐还没有完成节拍分析。' }
    const beats = evidence.beats
      .filter((beat) => args.startSeconds === undefined || beat >= args.startSeconds)
      .filter((beat) => args.endSeconds === undefined || beat <= args.endSeconds)
      .slice(0, 300)
    return {
      ok: true,
      message: `这段音乐约为 ${Math.round(evidence.tempoBpm)} BPM，共返回 ${beats.length} 个节拍点。`,
      data: { mediaId: evidence.mediaId, tempoBpm: evidence.tempoBpm, beats },
    }
  },
})

const analyzeBeats = defineTool({
  id: 'audio.analyze_beats',
  title: '分析音乐节拍',
  description: '使用本地音频分析识别 BPM 和节拍时间点。',
  risk: 'analysis',
  inputSchema: objectSchema({ mediaId: { type: 'string', description: '音乐素材。' } }, ['mediaId']),
  schema: z.object({ mediaId: z.string().min(1) }),
  summarize: () => '分析音乐节拍',
  execute: async (args) => {
    const evidence = await analyzeAudioBeats(args.mediaId)
    return {
      ok: true,
      message: `已识别音乐节拍，速度约为 ${Math.round(evidence.tempoBpm)} BPM。`,
      data: { mediaId: evidence.mediaId, tempoBpm: evidence.tempoBpm, beatCount: evidence.beats.length },
    }
  },
})

function sourceStartSeconds(item: { sourceStart?: number; trimStart?: number; offset?: number; sourceFps?: number }, fallbackFps: number): number {
  const sourceFrame = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
  return sourceFrame / (item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fallbackFps)
}

const splitOnBeats = defineTool({
  id: 'timeline.split_on_beats',
  title: '按节拍切分片段',
  description: '将指定视频或音频片段切分到音乐的节拍点。音乐必须已完成节拍分析。',
  risk: 'edit',
  inputSchema: objectSchema({
    musicClipId: { type: 'string', description: '时间轴上的音乐片段 ID。' },
    clipIds: { type: 'array', items: { type: 'string' }, description: '需要按节拍切分的时间轴片段 ID。' },
    every: { type: 'number', minimum: 1, maximum: 8, description: '每隔几个节拍切一次，默认每拍。' },
    offsetMilliseconds: { type: 'number', minimum: -300, maximum: 300, description: '相对节拍的微调，默认 0。' },
  }, ['musicClipId', 'clipIds']),
  schema: z.object({
    musicClipId: z.string().min(1),
    clipIds: z.array(z.string()).min(1),
    every: z.number().int().min(1).max(8).optional(),
    offsetMilliseconds: z.number().min(-300).max(300).optional(),
  }),
  summarize: (args) => `按音乐节拍切分 ${args.clipIds.length} 个片段`,
  execute: (args) => {
    const timeline = useTimelineStore.getState()
    const music = timeline.items.find((item) => item.id === args.musicClipId)
    if (!music || (music.type !== 'audio' && music.type !== 'video') || !music.mediaId) {
      return { ok: false, message: '请指定时间轴上的音乐片段。' }
    }
    if (music.isReversed) return { ok: false, message: '暂不支持倒放音乐的节拍切分。' }
    const beatEvidence = getAudioBeatEvidence(music.mediaId)
    if (!beatEvidence) return { ok: false, message: '请先分析这段音乐的节拍。' }

    const fps = timeline.fps > 0 ? timeline.fps : 30
    const sourceStart = sourceStartSeconds(music, fps)
    const speed = music.speed && music.speed > 0 ? music.speed : 1
    const offsetSeconds = (args.offsetMilliseconds ?? 0) / 1_000
    const timelineBeats = beatEvidence.beats
      .filter((_, index) => index % (args.every ?? 1) === 0)
      .map((beat) => music.from / fps + (beat - sourceStart) / speed + offsetSeconds)
      .filter((time) => Number.isFinite(time))

    let splitCount = 0
    for (const clipId of args.clipIds) {
      const clip = timeline.items.find((item) => item.id === clipId)
      if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue
      const frames = timelineBeats
        .map((time) => Math.round(time * fps))
        .filter((frame) => frame > clip.from && frame < clip.from + clip.durationInFrames)
      if (frames.length > 0) splitCount += timeline.splitItemAtFrames(clip.id, frames)
    }
    return {
      ok: splitCount > 0,
      message: splitCount > 0 ? `已在 ${splitCount} 个节拍点切分片段。` : '指定片段内没有可用的节拍点。',
    }
  },
})

const inspectSettings = defineTool({
  id: 'settings.inspect',
  title: '查看编辑设置',
  description: '读取可由剪辑助手调整的用户设置，不包含账号和密钥。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.object({}),
  summarize: () => '查看编辑设置',
  execute: () => ({
    ok: true,
    message: '已读取可调整的编辑设置。',
    data: { definitions: listAiEditableSettings(), values: getAiEditableSettings() },
  }),
})

const updateSettings = defineTool({
  id: 'settings.update',
  title: '调整编辑设置',
  description: '调整用户可见的编辑设置。应用前会展示变更内容。',
  risk: 'settings',
  inputSchema: objectSchema({
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: {} },
        required: ['key', 'value'],
      },
    },
  }, ['changes']),
  schema: z.object({ changes: z.array(z.object({ key: z.string(), value: z.unknown() })).min(1) }),
  summarize: (args) => `调整 ${args.changes.length} 项编辑设置`,
  execute: (args) => {
    const validation = validateAiSettingChanges(args.changes)
    if (!validation.ok) return { ok: false, message: validation.error }
    applyAiSettingChanges(validation.changes)
    return { ok: true, message: `已调整 ${validation.changes.length} 项编辑设置。`, data: validation.changes }
  },
})

function legacyTools(): AiEditingTool[] {
  return listEditorTools().map((tool) => ({
    id: `timeline.${tool.name}`,
    title: tool.title,
    description: tool.description,
    risk: tool.readOnly ? 'read' : tool.handoff ? 'analysis' : 'edit',
    execution: 'sync',
    inputSchema: tool.inputSchema,
    validate: tool.validate,
    summarize: tool.summarize,
    execute: (args) => tool.execute(args),
  }))
}

const tools = [
  inspectProject,
  searchTranscript,
  requestAnalysis,
  generateCaptions,
  inspectBeats,
  analyzeBeats,
  splitOnBeats,
  inspectSettings,
  updateSettings,
  ...legacyTools(),
]

const toolsById = new Map(tools.map((tool) => [tool.id, tool]))

export function listAiEditingTools(): readonly AiEditingTool[] {
  return tools
}

export function getAiEditingTool(id: string): AiEditingTool | undefined {
  return toolsById.get(id)
}
