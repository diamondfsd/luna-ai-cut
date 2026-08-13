import { z } from 'zod'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { projectToSourceFiles } from '@freecut/features/project-source/project-source-codec'
import { transformFromNormalizedTextBox } from '@freecut/features/project-source/normalized-text-layout'
import type { Project, ProjectTimeline } from '@freecut/types/project'
import type { MediaMetadata } from '@freecut/types/storage'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import type { DurableSourceChange } from '../coding-workspace/durable-source-repository'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const TRACK_IDS = {
  video: 'id-video',
  audio: 'id-audio',
  subtitle: 'id-subtitle',
} as const

const textBoxSchema = z.strictObject({
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine((box) => box.left + box.width <= 1 && box.top + box.height <= 1, {
  message: '字幕框必须完整位于画布内。',
})

const captionStyleSchema = z.strictObject({
  color: z.string().min(1).optional(),
  fontSize: z.number().positive().max(400).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  backgroundColor: z.string().min(1).optional(),
  backgroundRadius: z.number().min(0).max(200).optional(),
  textPadding: z.number().min(0).max(160).optional(),
})

const captionSchema = z.strictObject({
  text: z.string().min(1),
  style: captionStyleSchema.optional(),
  spans: z.array(z.strictObject({
    text: z.string(),
    color: z.string().min(1).optional(),
    fontWeight: z.enum(['normal', 'medium', 'semibold', 'bold']).optional(),
  })).min(1).max(20).optional(),
  box: textBoxSchema.optional(),
})

const clipSchema = z.strictObject({
  mediaId: z.string().trim().min(1),
  sourceStartSeconds: z.number().min(0),
  sourceEndSeconds: z.number().positive(),
  label: z.string().trim().min(1).optional(),
  caption: captionSchema.optional(),
}).refine((clip) => clip.sourceEndSeconds > clip.sourceStartSeconds, {
  message: '素材选段终点必须晚于起点。',
})

export const composeSourceSchema = z.strictObject({
  clips: z.array(clipSchema).min(1).max(32),
  includeOriginalAudio: z.boolean().default(true),
  replaceExisting: z.boolean().default(true),
})

type ComposeSourceInput = z.infer<typeof composeSourceSchema>

function frame(value: number, fps: number): number {
  return Math.max(0, Math.round(value * fps))
}

function mediaKind(media: MediaMetadata): 'video' | 'image' | null {
  if (media.mimeType.startsWith('video/')) return 'video'
  if (media.mimeType.startsWith('image/')) return 'image'
  return null
}

function baseTrackExists(project: Project, trackId: string): boolean {
  return Boolean(project.timeline?.tracks.some((track) => track.id === trackId))
}

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function composeSourceProject(
  project: Project,
  input: ComposeSourceInput,
  mediaById: Readonly<Record<string, MediaMetadata>>,
): Project {
  const fps = project.metadata.fps > 0 ? project.metadata.fps : 30
  const requiredTracks: string[] = [TRACK_IDS.video, TRACK_IDS.subtitle]
  if (input.includeOriginalAudio) requiredTracks.push(TRACK_IDS.audio)
  const missingTrack = requiredTracks.find((trackId) => !baseTrackExists(project, trackId))
  if (missingTrack) throw new Error(`基础轨道不存在：${missingTrack}`)

  const existingItems = project.timeline?.items ?? []
  const managedTrackIds = new Set(Object.values(TRACK_IDS))
  const retainedItems = input.replaceExisting
    ? existingItems.filter((item) => !managedTrackIds.has(item.trackId as typeof TRACK_IDS[keyof typeof TRACK_IDS]))
    : existingItems
  let cursor = input.replaceExisting
    ? 0
    : retainedItems.reduce((end, item) => Math.max(end, item.from + item.durationInFrames), 0)
  const items: ProjectTimeline['items'] = []

  for (const [index, selection] of input.clips.entries()) {
    const media = mediaById[selection.mediaId]
    if (!media) throw new Error(`素材不存在：${selection.mediaId}`)
    const kind = mediaKind(media)
    if (!kind) throw new Error(`素材“${media.fileName}”不是可编排的视频或图片。`)
    if (kind === 'video' && selection.sourceEndSeconds > media.duration + 0.001) {
      throw new Error(`素材“${media.fileName}”的选段超出实际时长。`)
    }

    const sourceFps = media.fps > 0 ? media.fps : fps
    const durationSeconds = selection.sourceEndSeconds - selection.sourceStartSeconds
    const durationInFrames = Math.max(1, frame(durationSeconds, fps))
    const sourceStart = frame(selection.sourceStartSeconds, sourceFps)
    const sourceEnd = Math.max(sourceStart + 1, frame(selection.sourceEndSeconds, sourceFps))
    const sourceDuration = Math.max(sourceEnd, frame(media.duration, sourceFps))
    const label = selection.label ?? media.fileName
    const linkedGroupId = kind === 'video' && input.includeOriginalAudio && Boolean(media.audioCodec)
      ? randomId('linked')
      : undefined
    const shared = {
      from: cursor,
      durationInFrames,
      label,
      mediaId: media.id,
      src: `media:${media.id}`,
      sourceStart,
      sourceEnd,
      sourceDuration,
      sourceFps,
      ...(linkedGroupId ? { linkedGroupId } : {}),
    }

    items.push({
      ...shared,
      id: randomId(`video-${index + 1}`),
      type: kind,
      trackId: TRACK_IDS.video,
      ...(kind === 'video' ? { embeddedAudioMuted: Boolean(linkedGroupId) } : {}),
      ...(media.width > 0 ? { sourceWidth: media.width } : {}),
      ...(media.height > 0 ? { sourceHeight: media.height } : {}),
    })

    if (linkedGroupId) {
      items.push({
        ...shared,
        id: randomId(`audio-${index + 1}`),
        type: 'audio',
        trackId: TRACK_IDS.audio,
        volume: 0,
      })
    }

    if (selection.caption) {
      const box = selection.caption.box ?? { left: 0.1, top: 0.78, width: 0.8, height: 0.12 }
      items.push({
        id: randomId(`caption-${index + 1}`),
        type: 'text',
        trackId: TRACK_IDS.subtitle,
        from: cursor,
        durationInFrames,
        label: selection.caption.text.slice(0, 40),
        text: selection.caption.text,
        color: selection.caption.style?.color ?? '#ffffff',
        fontSize: selection.caption.style?.fontSize ?? 48,
        textAlign: selection.caption.style?.textAlign ?? 'center',
        ...(selection.caption.style?.backgroundColor
          ? { backgroundColor: selection.caption.style.backgroundColor }
          : {}),
        ...(selection.caption.style?.backgroundRadius !== undefined
          ? { backgroundRadius: selection.caption.style.backgroundRadius }
          : {}),
        ...(selection.caption.style?.textPadding !== undefined
          ? { textPadding: selection.caption.style.textPadding }
          : {}),
        ...(selection.caption.spans
          ? { textSpans: selection.caption.spans, spanLayout: 'inline' as const }
          : {}),
        transform: transformFromNormalizedTextBox(box, project.metadata),
      })
    }
    cursor += durationInFrames
  }

  const allItems = [...retainedItems, ...items]
  const duration = allItems.reduce(
    (end, item) => Math.max(end, (item.from + item.durationInFrames) / fps),
    0,
  )
  return {
    ...project,
    duration,
    timeline: { ...(project.timeline ?? { tracks: [] }), items: allItems },
  }
}

async function contentRevision(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sourceChangesForProject(
  project: Project,
  currentFiles: ReadonlyMap<string, string>,
): Promise<DurableSourceChange[]> {
  const nextFiles = projectToSourceFiles(project)
  const segmentPrefix = 'sequences/main/tracks/'
  const relevantPaths = new Set([
    ...Object.keys(nextFiles).filter((path) => path.startsWith(segmentPrefix) && path.includes('/segments/')),
    ...[...currentFiles.keys()].filter((path) => path.startsWith(segmentPrefix) && path.includes('/segments/')),
    'manifest.json',
  ])
  const changes: DurableSourceChange[] = []
  for (const path of [...relevantPaths].sort()) {
    const before = currentFiles.get(path)
    const content = nextFiles[path] ?? null
    if (before === content || (before === undefined && content === null)) continue
    changes.push({
      path,
      content,
      expectedRevision: before === undefined ? null : await contentRevision(before),
    })
  }
  return changes
}

const composeSource = defineAiEditingTool({
  id: 'timeline.compose_source',
  title: '生成基础剪辑源码',
  description: '将已选好的素材区间、原声和字幕一次编译为 Git 工程源码。宿主负责帧率换算、音视频配对、默认三轨路径和原子写入；适合常规首剪，不需要先读取默认轨道。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({
    clips: {
      type: 'array', minItems: 1, maxItems: 32,
      description: '按成片顺序排列的镜头。',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          mediaId: { type: 'string', description: 'media.list 返回的原始素材 ID。' },
          sourceStartSeconds: { type: 'number', minimum: 0 },
          sourceEndSeconds: { type: 'number', exclusiveMinimum: 0 },
          label: { type: 'string' },
          caption: {
            type: 'object', additionalProperties: false,
            description: '该镜头对应的字幕。存在旁白时默认提供；用背景色保证可读性，并可用 spans 对少量重点词应用同一强调色。',
            properties: {
              text: { type: 'string', description: '忠于实际语音并按自然语义分段的完整字幕原文。' },
              style: {
                type: 'object', additionalProperties: false,
                properties: {
                  color: { type: 'string' }, fontSize: { type: 'number' },
                  textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
                  backgroundColor: { type: 'string', description: '与当前画面形成清晰对比的字幕背景色，建议包含适当透明度。' }, backgroundRadius: { type: 'number' },
                  textPadding: { type: 'number' },
                },
              },
              spans: {
                type: 'array', maxItems: 20,
                description: '按原文顺序拆分的文字片段；仅给重点词设置强调色，所有片段文字拼接后应与 text 完全一致，同一成片保持一种强调色。',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    text: { type: 'string' }, color: { type: 'string' },
                    fontWeight: { type: 'string', enum: ['normal', 'medium', 'semibold', 'bold'] },
                  },
                  required: ['text'],
                },
              },
              box: {
                type: 'object', additionalProperties: false,
                properties: {
                  left: { type: 'number' }, top: { type: 'number' },
                  width: { type: 'number' }, height: { type: 'number' },
                },
                required: ['left', 'top', 'width', 'height'],
              },
            },
            required: ['text'],
          },
        },
        required: ['mediaId', 'sourceStartSeconds', 'sourceEndSeconds'],
      },
    },
    includeOriginalAudio: { type: 'boolean', description: '默认保留视频中存在的原声。' },
    replaceExisting: { type: 'boolean', description: '默认替换三条基础轨道已有片段；false 时追加。' },
  }, ['clips']),
  schema: composeSourceSchema,
  summarize: ({ clips }) => `一次生成 ${clips.length} 个镜头的基础剪辑源码`,
  execute: async (input) => {
    const session = getTimelineCodingSession()
    const currentProject = await session.currentProject()
    const project = composeSourceProject(currentProject, input, useMediaLibraryStore.getState().mediaById)
    const currentFiles = new Map(session.repository.sourceSnapshot().map((file) => [file.path, file.content]))
    const changes = await sourceChangesForProject(project, currentFiles)
    if (changes.length === 0) return { ok: false, message: '生成结果没有产生源码变化。' }
    await session.applySourceChanges(changes)
    return {
      ok: true,
      message: `已原子生成 ${input.clips.length} 个镜头的基础剪辑源码。`,
      data: { clipCount: input.clips.length, changedFiles: changes.map((change) => change.path) },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [composeSource],
}
