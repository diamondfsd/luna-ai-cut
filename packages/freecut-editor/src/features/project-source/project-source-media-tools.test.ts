import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaMetadata } from '@freecut/types/storage'

const harness = vi.hoisted(() => {
  const items: MediaMetadata[] = Array.from({ length: 7 }, (_, index) => ({
    id: `media-${index + 1}`,
    storageType: 'workspace',
    fileName: index === 0 ? 'camera-a.mp4' : `asset-${index + 1}.${index === 2 ? 'mp3' : 'jpg'}`,
    fileSize: 1_000 + index,
    mimeType: index === 0 ? 'video/mp4' : index === 2 ? 'audio/mpeg' : 'image/jpeg',
    duration: index === 0 ? 12.3456 : index === 2 ? 8.5 : 0,
    width: index === 0 ? 1920 : 640,
    height: index === 0 ? 1080 : 480,
    fps: index === 0 ? 29.97 : 0,
    codec: index === 0 ? 'h264' : '',
    bitrate: index === 0 ? 4_000_000 : 0,
    ...(index === 0 ? { audioCodec: 'aac' } : {}),
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  }))
  const getMediaForProject = vi.fn(async () => items)
  const importGeneratedAudio = vi.fn()
  const getTranscript = vi.fn()
  const analyzeMediaVisual = vi.fn()
  const generateSpeechFile = vi.fn()
  const generateMusicFile = vi.fn()
  const host = {}
  const generatedAudio = {
    ...items[2],
    id: 'generated-audio-1',
    fileName: 'generated-audio.wav',
    mimeType: 'audio/wav',
    duration: 2.75,
  } as MediaMetadata
  return {
    items,
    generatedAudio,
    getMediaForProject,
    importGeneratedAudio,
    getTranscript,
    analyzeMediaVisual,
    generateSpeechFile,
    generateMusicFile,
    host,
    currentProjectId: 'project-1',
  }
})

vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: harness.currentProjectId } }) },
}))
vi.mock('@freecut/features/media-library/services/media-library-service-loader', () => ({
  importMediaLibraryService: vi.fn(async () => ({
    mediaLibraryService: {
      getMediaForProject: harness.getMediaForProject,
      importGeneratedAudio: harness.importGeneratedAudio,
    },
  })),
}))
vi.mock('@freecut/infrastructure/storage', () => ({
  getTranscript: harness.getTranscript,
}))
vi.mock('@freecut/shared/host/embedded-host', () => ({
  getEmbeddedHostBridge: () => harness.host,
}))
vi.mock('@freecut/features/media-library/services/media-visual-analysis-service', () => ({
  analyzeMediaVisual: harness.analyzeMediaVisual,
}))
vi.mock('@freecut/features/editor/services/moss-tts-service', () => ({
  MOSS_TTS_VOICE_OPTIONS: [
    { value: 'Junhao', label: 'Junhao (ZH, M)' },
    { value: 'Xiaoyu', label: 'Xiaoyu (ZH, F)' },
  ],
  mossTtsService: { generateSpeechFile: harness.generateSpeechFile },
}))
vi.mock('@freecut/features/editor/services/musicgen-service', () => ({
  DEFAULT_MUSICGEN_MODEL: 'musicgen-small',
  musicgenService: { generateMusicFile: harness.generateMusicFile },
}))

import { MEDIA_AI_TOOLS } from './project-source-media-tools'
import { __audioTaskTestUtils } from './project-source-audio-tasks'
import { __mediaAnalysisTaskTestUtils } from './project-source-media-tasks'

function getTool(name: string) {
  const tool = MEDIA_AI_TOOLS.find((entry) => entry.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool
}

describe('project media AI tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __audioTaskTestUtils.clear()
    __mediaAnalysisTaskTestUtils.clear()
    harness.currentProjectId = 'project-1'
    for (const item of harness.items) delete item.aiCaptions
    harness.getTranscript.mockResolvedValue(undefined)
    harness.analyzeMediaVisual.mockResolvedValue({ captions: [], intensity: 'light' })
    harness.importGeneratedAudio.mockImplementation(async (file: File) => ({
      ...harness.generatedAudio,
      fileName: file.name,
    }))
    harness.generateSpeechFile.mockResolvedValue({
      blob: new Blob(['speech'], { type: 'audio/wav' }),
      file: new File(['speech'], 'speech.wav', { type: 'audio/wav' }),
      duration: 2.5,
    })
    harness.generateMusicFile.mockResolvedValue({
      blob: new Blob(['music'], { type: 'audio/wav' }),
      file: new File(['music'], 'music.wav', { type: 'audio/wav' }),
      duration: 8,
    })
  })

  it('lists all seven project media items with editing metadata', async () => {
    const result = await getTool('media.list').execute({})
    const data = result.data as { total: number; truncated: boolean; items: Array<Record<string, unknown>> }
    expect(data.total).toBe(7)
    expect(data.truncated).toBe(false)
    expect(data.items).toHaveLength(7)
    expect(data.items[0]).toMatchObject({
      id: 'media-1',
      fileName: 'camera-a.mp4',
      mediaType: 'video',
      durationSeconds: 12.346,
      width: 1920,
      height: 1080,
      fps: 29.97,
      sizeBytes: 1000,
      hasAudio: true,
    })
    expect(data.items[2]).toMatchObject({ id: 'media-3', mediaType: 'audio', durationSeconds: 8.5, hasAudio: true })
    expect(harness.getMediaForProject).toHaveBeenCalledWith('project-1')
  })

  it('reads LFM visual observations and timestamped transcript segments', async () => {
    harness.items[0]!.aiCaptions = [{
      timeSec: 2,
      text: '人物正在镜头前讲话',
      sceneData: { subjects: ['人物'], action: '讲话' },
    }]
    harness.getTranscript.mockResolvedValue({
      mediaId: 'media-1',
      id: 'media-1',
      model: 'whisper-base',
      quantization: 'hybrid',
      text: '欢迎来到现场',
      segments: [{ text: '欢迎来到现场', start: 1.2, end: 2.8 }],
      createdAt: 1,
      updatedAt: 2,
    })
    const result = await getTool('media.read').execute({ mediaIds: ['media-1'] })
    expect(result.data).toMatchObject({
      items: [{
        id: 'media-1',
        visual: {
          status: 'ready',
          samples: [
            { timeSeconds: 2, description: '人物正在镜头前讲话', subjects: ['人物'], action: '讲话' },
          ],
        },
        transcript: {
          status: 'ready',
          segmentCount: 1,
          segments: [{ startSeconds: 1.2, endSeconds: 2.8, text: '欢迎来到现场' }],
        },
      }],
    })
  })

  it('submits a visual analysis task and exposes its completed result', async () => {
    const submitted = await getTool('media.analyze').execute({
      mediaIds: ['media-1'],
      kind: 'visual',
      intensity: 'strong',
    })
    const taskId = (submitted.data as { taskId: string }).taskId
    const result = await waitForMediaTask(taskId)

    expect(result.data).toMatchObject({ status: 'completed', kind: 'visual', completedIds: ['media-1'] })
    expect(harness.analyzeMediaVisual).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'media-1', fileName: 'camera-a.mp4', duration: 12.3456 }),
      'strong',
      expect.any(AbortSignal),
    )
  })

  it('passes the fast visual intensity to the LFM analysis service when omitted', async () => {
    const submitted = await getTool('media.analyze').execute({ mediaIds: ['media-1'], kind: 'visual' })
    await waitForMediaTask((submitted.data as { taskId: string }).taskId)

    expect(harness.analyzeMediaVisual).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'media-1' }),
      'light',
      expect.any(AbortSignal),
    )
  })

  it('reuses an active task for the same media request', async () => {
    harness.analyzeMediaVisual.mockImplementationOnce(() => new Promise(() => {}))
    const first = await getTool('media.analyze').execute({ mediaIds: ['media-1'], kind: 'visual' })
    const second = await getTool('media.analyze').execute({ mediaIds: ['media-1'], kind: 'visual' })

    expect((second.data as { taskId: string }).taskId).toBe((first.data as { taskId: string }).taskId)
  })

  it('does not expose an analysis task after the active project changes', async () => {
    harness.analyzeMediaVisual.mockImplementationOnce(() => new Promise(() => {}))
    const submitted = await getTool('media.analyze').execute({ mediaIds: ['media-1'], kind: 'visual' })
    const taskId = (submitted.data as { taskId: string }).taskId
    harness.currentProjectId = 'project-2'

    await expect(getTool('media.get_analysis_task').execute({ taskId })).rejects.toThrow('没有找到当前项目中的素材分析任务')
    harness.currentProjectId = 'project-1'
  })

  it('keeps analysis failures queryable instead of rejecting the submission', async () => {
    harness.analyzeMediaVisual.mockRejectedValueOnce(new Error('视觉模型不可用'))
    const submitted = await getTool('media.analyze').execute({ mediaIds: ['media-1'], kind: 'visual' })
    const result = await waitForMediaTask((submitted.data as { taskId: string }).taskId)

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      status: 'failed',
      failedIds: ['media-1'],
      failures: [{ mediaId: 'media-1', error: '视觉模型不可用' }],
      error: '视觉模型不可用',
    })
  })

  it('exposes structured LFM scene fields through media.read', async () => {
    harness.items[0]!.aiCaptions = [{
      timeSec: 1,
      text: 'A sunset over the sea',
      sceneData: {
        subjects: ['海面'],
        setting: '海边',
        lighting: '暖色夕阳',
        timeOfDay: '日落',
        weather: '晴朗',
      },
    }]

    const result = await getTool('media.read').execute({ mediaIds: ['media-1'] })
    expect(result.data).toMatchObject({
      items: [{ visual: { samples: [{
        timeSeconds: 1,
        setting: '海边',
        lighting: '暖色夕阳',
        timeOfDay: '日落',
        weather: '晴朗',
      }] } }],
    })
  })

  it('submits a MOSS speech task and exposes the saved media after completion', async () => {
    const submitted = await getTool('audio.start_speech').execute({
      text: '欢迎来到日落海边。',
      voice: 'Xiaoyu',
      speed: 1.25,
    })
    const taskId = (submitted.data as { taskId: string }).taskId
    const result = await waitForTask(taskId)

    expect(harness.generateSpeechFile).toHaveBeenCalledWith(expect.objectContaining({
      text: '欢迎来到日落海边。',
      voice: 'Xiaoyu',
      speed: 1.25,
      onProgress: expect.any(Function),
    }))
    expect(harness.importGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'speech.wav' }),
      'project-1',
      { tags: ['ai-generated', 'moss-tts', 'tts-engine:moss', 'moss-voice:Xiaoyu'] },
    )
    expect(result.data).toMatchObject({
      mediaId: 'generated-audio-1',
      fileName: 'speech.wav',
      durationSeconds: 2.75,
      mediaType: 'audio',
      engine: 'moss-tts',
      voice: 'Xiaoyu',
      speed: 1.25,
    })
  })

  it('submits a MusicGen task and exposes progress and the saved media after completion', async () => {
    const result = await getTool('audio.start_music').execute({
      prompt: '温暖舒缓的日落氛围音乐，不要人声。',
      model: 'musicgen-small',
      durationSeconds: 12,
      guidanceScale: 4,
    })
    const taskId = (result.data as { taskId: string }).taskId
    const completed = await waitForTask(taskId)

    expect(harness.generateMusicFile).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '温暖舒缓的日落氛围音乐，不要人声。',
      model: 'musicgen-small',
      durationSeconds: 12,
      guidanceScale: 4,
      onProgress: expect.any(Function),
    }))
    expect(harness.importGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'music.wav' }),
      'project-1',
      { tags: ['ai-generated', 'musicgen', 'musicgen-model:musicgen-small', 'musicgen-target:12s'] },
    )
    expect(completed.data).toMatchObject({
      mediaId: 'generated-audio-1',
      fileName: 'music.wav',
      durationSeconds: 2.75,
      mediaType: 'audio',
      engine: 'musicgen',
      model: 'musicgen-small',
      targetDurationSeconds: 12,
      guidanceScale: 4,
    })
  })

  it('rejects invalid audio task parameters before invoking a model', () => {
    expect(getTool('audio.start_speech').validate({
      text: 'hello',
      voice: 'unknown',
      speed: 1,
    })).toMatchObject({ ok: false })
    expect(getTool('audio.start_music').validate({
      prompt: 'music',
      durationSeconds: 1,
    })).toMatchObject({ ok: false })
    expect(harness.generateSpeechFile).not.toHaveBeenCalled()
    expect(harness.generateMusicFile).not.toHaveBeenCalled()
  })

  it('keeps model failures queryable as a failed task', async () => {
    harness.generateMusicFile.mockRejectedValueOnce(new Error('模型下载失败'))
    const submitted = await getTool('audio.start_music').execute({ prompt: '测试音乐' })
    const taskId = (submitted.data as { taskId: string }).taskId
    const result = await waitForTask(taskId)

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ status: 'failed', error: '模型下载失败' })
  })

  it('does not reveal a task after the active project changes', async () => {
    harness.generateMusicFile.mockImplementationOnce(() => new Promise(() => {}))
    const submitted = await getTool('audio.start_music').execute({ prompt: '保持等待' })
    const taskId = (submitted.data as { taskId: string }).taskId
    harness.currentProjectId = 'project-2'

    await expect(getTool('audio.get_task').execute({ taskId })).rejects.toThrow('没有找到当前项目中的音频生成任务')
    harness.currentProjectId = 'project-1'
  })
})

async function waitForTask(taskId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = await getTool('audio.get_task').execute({ taskId })
    const data = result.data as { status: string }
    if (data.status === 'completed' || data.status === 'failed') return result
  }
  throw new Error(`音频任务 ${taskId} 未在测试时间内完成。`)
}

async function waitForMediaTask(taskId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = await getTool('media.get_analysis_task').execute({ taskId })
    const data = result.data as { status: string }
    if (data.status === 'completed' || data.status === 'failed') return result
  }
  throw new Error(`素材分析任务 ${taskId} 未在测试时间内完成。`)
}
