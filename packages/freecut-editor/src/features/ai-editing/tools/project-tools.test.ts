// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  buildProjectEvidence: vi.fn(),
  buildAgentMediaCatalog: vi.fn(),
}))

vi.mock('../evidence', () => ({ buildProjectEvidence: mocks.buildProjectEvidence }))
vi.mock('../workspace-document/build-workspace-document', () => ({
  buildAgentMediaCatalog: mocks.buildAgentMediaCatalog,
}))

import { aiEditingToolModule } from './project-tools'

const tools = aiEditingToolModule.createTools({ listTools: () => [] })
const tool = (id: string) => tools.find((candidate) => candidate.id === id)!

describe('project media tools', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters and paginates structured media summaries', async () => {
    mocks.buildAgentMediaCatalog.mockResolvedValue([
        {
          ref: 'media:video-1', name: 'Product Demo.mp4', kind: 'video', duration: 12,
          width: 1920, height: 1080, hasAudio: true,
          evidence: { visual: [{ time: 0, description: 'UI', subjects: [] }], audioAnalysis: 'ready' },
        },
        {
          ref: 'media:image-1', name: 'Product Cover.png', kind: 'image', duration: 0,
          evidence: { visual: [], audioAnalysis: 'missing' },
        },
        {
          ref: 'media:video-2', name: 'Interview.mp4', kind: 'video', duration: 30,
          evidence: { visual: [], transcript: { segmentCount: 2 }, audioAnalysis: 'missing' },
        },
    ])

    const result = await tool('media.list').execute({
      query: 'product', kinds: ['video', 'image'], cursor: 1, limit: 1,
    })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({
      cursor: 1,
      nextCursor: null,
      total: 2,
      items: [{
        id: 'image-1', name: 'Product Cover.png', kind: 'image',
        duration: 0, width: undefined, height: undefined, hasAudio: false,
        evidence: { visualSampleCount: 0, hasTranscript: false, audioAnalysis: 'missing' },
      }],
    })
  })

  it('reads evidence by raw IDs and media references', async () => {
    mocks.buildProjectEvidence.mockResolvedValue({
      media: [
        { mediaId: 'video-1', name: 'One', kind: 'video', durationSeconds: 10, sourceFingerprint: 'private', visualModels: [{ id: 'm', version: '1' }], visual: [], audio: { beatStatus: 'ready' } },
        { mediaId: 'video-2', name: 'Two', kind: 'video', durationSeconds: 20, sourceFingerprint: 'private', visual: [], audio: { beatStatus: 'not-requested' } },
      ],
    })

    const result = await tool('media.read').execute({ mediaIds: ['video-1', 'media:video-2'] })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({
      missingMediaIds: [],
      media: [
        { mediaId: 'video-1', name: 'One', kind: 'video', durationSeconds: 10, visual: [], audio: { beatStatus: 'ready' } },
        { mediaId: 'video-2', name: 'Two', kind: 'video', durationSeconds: 20, visual: [], audio: { beatStatus: 'not-requested' } },
      ],
    })
  })

  it('reports missing IDs instead of silently treating a partial read as complete', async () => {
    mocks.buildProjectEvidence.mockResolvedValue({
      media: [{ mediaId: 'video-1', name: 'One', kind: 'video', durationSeconds: 10, visual: [], audio: { beatStatus: 'ready' } }],
    })

    const result = await tool('media.read').execute({
      mediaIds: ['missing', 'video-1'], visualLimit: 4,
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('1 个素材未找到')
    expect(result.data).toMatchObject({ missingMediaIds: ['missing'] })
  })

  it('rejects duplicate media kinds consistently with its JSON schema', () => {
    const result = tool('media.list').validate({ kinds: ['video', 'video'] })

    expect(result.ok).toBe(false)
  })
})
