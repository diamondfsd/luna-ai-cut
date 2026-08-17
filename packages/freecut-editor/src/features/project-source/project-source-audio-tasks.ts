import { z } from 'zod'
import { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import {
  MOSS_TTS_VOICE_OPTIONS,
  mossTtsService,
  type MossTtsVoice,
} from '@freecut/features/editor/services/moss-tts-service'
import {
  DEFAULT_MUSICGEN_MODEL,
  musicgenService,
  type MusicgenModelId,
} from '@freecut/features/editor/services/musicgen-service'
import { MUSICGEN_MODEL_IDS } from '@freecut/shared/utils/musicgen-models'
import type {
  ProjectEditingJsonSchema,
  ProjectEditingTool,
  ProjectEditingToolResult,
} from './project-source-tools'

const MAX_GENERATED_SPEECH_TEXT_LENGTH = 10_000
const MAX_GENERATED_MUSIC_PROMPT_LENGTH = 1_000
const MUSICGEN_MIN_DURATION_SECONDS = 2
const MUSICGEN_MAX_DURATION_SECONDS = 30
const MOSS_TTS_VOICE_VALUES = MOSS_TTS_VOICE_OPTIONS.map((option) => option.value) as [
  MossTtsVoice,
  ...MossTtsVoice[],
]

type AudioTaskKind = 'speech' | 'music'
type AudioTaskStatus =
  | 'queued'
  | 'preparing-model'
  | 'generating'
  | 'saving'
  | 'completed'
  | 'failed'

interface AudioTask {
  id: string
  projectId: string
  kind: AudioTaskKind
  status: AudioTaskStatus
  stage: string
  progress: number | null
  createdAt: number
  updatedAt: number
  mediaId?: string
  fileName?: string
  durationSeconds?: number
  error?: string
  details: Record<string, unknown>
}

function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): ProjectEditingJsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function validate<S extends z.ZodType>(input: unknown, value: S) {
  const result = value.safeParse(input ?? {})
  if (result.success) return { ok: true as const, value: result.data as Record<string, unknown> }
  const issue = result.error.issues[0]
  return { ok: false as const, error: `${issue?.path.join('.') || 'args'}: ${issue?.message || '参数无效'}` }
}

function tool<S extends z.ZodType>(input: {
  name: string
  description: string
  inputSchema: ProjectEditingJsonSchema
  schema: S
  execute: (args: z.infer<S>, signal?: AbortSignal) => Promise<ProjectEditingToolResult>
}): ProjectEditingTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    validate: (args) => validate(args, input.schema),
    execute: (args, signal) => input.execute(args as z.infer<S>, signal),
  }
}

const tasks = new Map<string, AudioTask>()

function currentProjectId(): string {
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前没有打开的项目。')
  return projectId
}

function createTaskId(): string {
  return `audio-task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function taskSnapshot(task: AudioTask): Record<string, unknown> {
  return {
    taskId: task.id,
    kind: task.kind,
    status: task.status,
    stage: task.stage,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.mediaId ? { mediaId: task.mediaId } : {}),
    ...(task.fileName ? { fileName: task.fileName } : {}),
    ...(task.durationSeconds !== undefined ? { durationSeconds: task.durationSeconds } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...task.details,
  }
}

function updateTask(
  task: AudioTask,
  update: Partial<Pick<AudioTask, 'status' | 'stage' | 'progress' | 'mediaId' | 'fileName' | 'durationSeconds' | 'error'>>,
): void {
  Object.assign(task, update, { updatedAt: Date.now() })
}

function getTaskForProject(taskId: string, projectId: string): AudioTask {
  const task = tasks.get(taskId)
  if (!task || task.projectId !== projectId) {
    throw new Error('没有找到当前项目中的音频生成任务。')
  }
  return task
}

async function saveGeneratedAudio(
  file: File,
  projectId: string,
  tags: string[],
): Promise<{ id: string; fileName: string; duration: number }> {
  const { mediaLibraryService } = await importMediaLibraryService()
  return mediaLibraryService.importGeneratedAudio(file, projectId, { tags })
}

function runTask(task: AudioTask, run: () => Promise<void>): void {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    updateTask(task, {
      status: 'failed',
      stage: '音频生成失败',
      progress: null,
      error: message,
    })
  })
}

const audioStartSpeech = tool({
  name: 'audio.start_speech',
  description: '提交本地 MOSS TTS 语音生成任务。模型下载和生成会在后台进行，立即返回 taskId；必须使用 audio.get_task 查询，直到 status 为 completed 后才可读取 mediaId 并加入时间轴。',
  inputSchema: schema({
    text: { type: 'string', minLength: 1, maxLength: MAX_GENERATED_SPEECH_TEXT_LENGTH },
    voice: { type: 'string', enum: MOSS_TTS_VOICE_VALUES, default: MOSS_TTS_VOICE_VALUES[0] },
    speed: { type: 'number', minimum: 0.5, maximum: 2, default: 1 },
  }, ['text']),
  schema: z.object({
    text: z.string().trim().min(1).max(MAX_GENERATED_SPEECH_TEXT_LENGTH),
    voice: z.enum(MOSS_TTS_VOICE_VALUES).default(MOSS_TTS_VOICE_VALUES[0]),
    speed: z.number().min(0.5).max(2).default(1),
  }),
  execute: async (args, signal) => {
    signal?.throwIfAborted()
    const projectId = currentProjectId()
    const now = Date.now()
    const task: AudioTask = {
      id: createTaskId(),
      projectId,
      kind: 'speech',
      status: 'queued',
      stage: '语音任务已提交，等待模型准备。',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      details: { engine: 'moss-tts', mediaType: 'audio', voice: args.voice, speed: args.speed },
    }
    tasks.set(task.id, task)

    runTask(task, async () => {
      updateTask(task, { status: 'preparing-model', stage: '正在准备 MOSS 模型。', progress: null })
      const result = await mossTtsService.generateSpeechFile({
        text: args.text,
        voice: args.voice,
        speed: args.speed,
        onProgress: (stage, fraction, phase) => {
          updateTask(task, {
            status: phase === 'generating' ? 'generating' : 'preparing-model',
            stage,
            progress: fraction ?? (phase === 'generating' ? null : task.progress),
          })
        },
      })
      updateTask(task, { status: 'saving', stage: '正在保存生成的语音。', progress: null })
      const media = await saveGeneratedAudio(result.file, projectId, [
        'ai-generated',
        'moss-tts',
        'tts-engine:moss',
        `moss-voice:${args.voice}`,
      ])
      updateTask(task, {
        status: 'completed',
        stage: '语音已生成并保存。',
        progress: 1,
        mediaId: media.id,
        fileName: media.fileName,
        durationSeconds: media.duration,
      })
    })

    return {
      ok: true,
      message: '语音生成任务已提交。请查询 taskId，完成后再使用 mediaId。',
      data: taskSnapshot(task),
    }
  },
})

const audioStartMusic = tool({
  name: 'audio.start_music',
  description: '提交本地 MusicGen 背景音乐生成任务。模型下载和生成会在后台进行，立即返回 taskId；必须使用 audio.get_task 查询，直到 status 为 completed 后才可读取 mediaId 并加入时间轴。',
  inputSchema: schema({
    prompt: { type: 'string', minLength: 1, maxLength: MAX_GENERATED_MUSIC_PROMPT_LENGTH },
    model: { type: 'string', enum: MUSICGEN_MODEL_IDS, default: DEFAULT_MUSICGEN_MODEL },
    durationSeconds: {
      type: 'number',
      minimum: MUSICGEN_MIN_DURATION_SECONDS,
      maximum: MUSICGEN_MAX_DURATION_SECONDS,
      default: 8,
    },
    guidanceScale: { type: 'number', minimum: 0, maximum: 10, default: 3 },
  }, ['prompt']),
  schema: z.object({
    prompt: z.string().trim().min(1).max(MAX_GENERATED_MUSIC_PROMPT_LENGTH),
    model: z.enum(MUSICGEN_MODEL_IDS).default(DEFAULT_MUSICGEN_MODEL),
    durationSeconds: z.number()
      .min(MUSICGEN_MIN_DURATION_SECONDS)
      .max(MUSICGEN_MAX_DURATION_SECONDS)
      .default(8),
    guidanceScale: z.number().min(0).max(10).default(3),
  }),
  execute: async (args, signal) => {
    signal?.throwIfAborted()
    const projectId = currentProjectId()
    const now = Date.now()
    const task: AudioTask = {
      id: createTaskId(),
      projectId,
      kind: 'music',
      status: 'queued',
      stage: '音乐任务已提交，等待模型准备。',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      details: {
        engine: 'musicgen',
        mediaType: 'audio',
        model: args.model,
        targetDurationSeconds: args.durationSeconds,
        guidanceScale: args.guidanceScale,
      },
    }
    tasks.set(task.id, task)

    runTask(task, async () => {
      updateTask(task, { status: 'preparing-model', stage: '正在准备 MusicGen 模型。', progress: 0 })
      const result = await musicgenService.generateMusicFile({
        prompt: args.prompt,
        model: args.model as MusicgenModelId,
        durationSeconds: args.durationSeconds,
        guidanceScale: args.guidanceScale,
        onProgress: (stage, fraction, phase) => {
          updateTask(task, {
            status: phase === 'generating' ? 'generating' : 'preparing-model',
            stage,
            progress: fraction ?? task.progress,
          })
        },
      })
      updateTask(task, { status: 'saving', stage: '正在保存生成的音乐。', progress: null })
      const media = await saveGeneratedAudio(result.file, projectId, [
        'ai-generated',
        'musicgen',
        `musicgen-model:${args.model}`,
        `musicgen-target:${args.durationSeconds}s`,
      ])
      updateTask(task, {
        status: 'completed',
        stage: '音乐已生成并保存。',
        progress: 1,
        mediaId: media.id,
        fileName: media.fileName,
        durationSeconds: media.duration,
      })
    })

    return {
      ok: true,
      message: '音乐生成任务已提交。请查询 taskId，完成后再使用 mediaId。',
      data: taskSnapshot(task),
    }
  },
})

const audioGetTask = tool({
  name: 'audio.get_task',
  description: '查询当前项目的音频生成任务。只有 status 为 completed 且返回 mediaId 时，生成结果才可以加入时间轴；failed 时读取 error。',
  inputSchema: schema({ taskId: { type: 'string', minLength: 1 } }, ['taskId']),
  schema: z.object({ taskId: z.string().trim().min(1) }),
  execute: async (args) => {
    const task = getTaskForProject(args.taskId, currentProjectId())
    return {
      ok: true,
      message: task.status === 'completed' ? '音频任务已完成。' : task.status === 'failed' ? '音频任务失败。' : '音频任务仍在处理中。',
      data: taskSnapshot(task),
    }
  },
})

export const AUDIO_TASK_TOOLS: readonly ProjectEditingTool[] = [
  audioStartSpeech,
  audioStartMusic,
  audioGetTask,
]

export const __audioTaskTestUtils = {
  clear: () => tasks.clear(),
}
