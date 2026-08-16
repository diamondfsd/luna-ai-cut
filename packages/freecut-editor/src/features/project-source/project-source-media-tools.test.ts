import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedVisualEvidence } from '@freecut/shared/host/embedded-host'
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
  const getTranscript = vi.fn()
  const getEditingEvidence = vi.fn()
  const saveVisualEditingEvidence = vi.fn()
  const host = {
    analyzeMediaVisual: undefined as
      | ((source: unknown, intensity: string) => Promise<EmbeddedVisualEvidence>)
      | undefined,
  }
  return { items, getMediaForProject, getTranscript, getEditingEvidence, saveVisualEditingEvidence, host }
})

vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'project-1' } }) },
}))
vi.mock('@freecut/features/media-library/services/media-library-service-loader', () => ({
  importMediaLibraryService: vi.fn(async () => ({ mediaLibraryService: { getMediaForProject: harness.getMediaForProject } })),
}))
vi.mock('@freecut/infrastructure/storage', () => ({
  getTranscript: harness.getTranscript,
  getEditingEvidence: harness.getEditingEvidence,
  saveVisualEditingEvidence: harness.saveVisualEditingEvidence,
}))
vi.mock('@freecut/shared/host/embedded-host', () => ({
  getEmbeddedHostBridge: () => harness.host,
}))

import { MEDIA_AI_TOOLS } from './project-source-media-tools'

function getTool(name: string) {
  const tool = MEDIA_AI_TOOLS.find((entry) => entry.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool
}

describe('project media AI tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.getTranscript.mockResolvedValue(undefined)
    harness.getEditingEvidence.mockResolvedValue(undefined)
    harness.host.analyzeMediaVisual = undefined
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

  it('reads local visual observations and timestamped transcript segments', async () => {
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
    harness.getEditingEvidence.mockResolvedValue({
      sourceFingerprint: '1000:1',
      visual: {
        samples: [{ timeSeconds: 4, tags: ['室内', '人物'] }],
        models: [{ id: 'luna-vision', version: '1' }],
        intensity: 'normal',
      },
    })

    const result = await getTool('media.read').execute({ mediaIds: ['media-1'] })
    expect(result.data).toMatchObject({
      items: [{
        id: 'media-1',
        visual: {
          status: 'ready',
          samples: [
            { timeSeconds: 2, description: '人物正在镜头前讲话', subjects: ['人物'], action: '讲话' },
            { timeSeconds: 4, description: '室内、人物', subjects: ['室内', '人物'] },
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

  it('asks the host local vision model for frame observations and persists them', async () => {
    const resultEvidence = {
      samples: [{ timeSeconds: 1, tags: ['人物', '户外'] }],
      models: [{ id: 'luna-vision', version: '1' }],
      sourceFingerprint: { size: 1000, modifiedAtMs: 1 },
      intensity: 'strong',
    } satisfies EmbeddedVisualEvidence
    harness.host.analyzeMediaVisual = vi.fn(async () => resultEvidence)

    const result = await getTool('media.analyze').execute({
      mediaIds: ['media-1'],
      kind: 'visual',
      intensity: 'strong',
    })

    expect(result.data).toMatchObject({ kind: 'visual', completedIds: ['media-1'] })
    expect(harness.host.analyzeMediaVisual).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'media-1', fileName: 'camera-a.mp4', durationSeconds: 12.3456 }),
      'strong',
    )
    expect(harness.saveVisualEditingEvidence).toHaveBeenCalledWith(
      'media-1',
      '1000:1',
      expect.objectContaining({ samples: resultEvidence.samples, models: resultEvidence.models, intensity: 'strong' }),
    )
  })

  it('uses the fast visual analysis intensity when it is omitted', async () => {
    const resultEvidence = {
      samples: [{ timeSeconds: 1, tags: ['人物'] }],
      models: [{ id: 'luna-vision', version: '1' }],
      sourceFingerprint: { size: 1000, modifiedAtMs: 1 },
      intensity: 'light',
    } satisfies EmbeddedVisualEvidence
    harness.host.analyzeMediaVisual = vi.fn(async () => resultEvidence)

    await getTool('media.analyze').execute({ mediaIds: ['media-1'], kind: 'visual' })

    expect(harness.host.analyzeMediaVisual).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'media-1' }),
      'light',
    )
  })
})
