import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const media = {
    id: 'media-2',
    storageType: 'workspace',
    fileName: 'B-roll.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 4,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 1000,
    tags: [],
  }
  const mediaLibraryService = {
    getMediaForProject: vi.fn(async () => [media]),
  }
  const state = {
    fps: 30,
    tracks: [{ id: 'track-video', name: 'V1', kind: 'video', order: 0, locked: false, visible: true, muted: false }],
    items: [{
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 300,
      label: '采访',
      mediaId: 'media-1',
      volume: 0,
    }],
    transitions: [],
    keyframes: [],
    trimItemStart: vi.fn(),
    trimItemEnd: vi.fn(),
    splitItem: vi.fn(),
    setTracks: vi.fn(),
    addItems: vi.fn(),
    saveTimeline: vi.fn(),
  }
  const resolveMediaUrl = vi.fn(async () => 'blob:media-2')
  return {
    state,
    media,
    mediaLibraryService,
    resolveMediaUrl,
    project: { id: 'project-1', name: 'Demo', duration: 99, metadata: { width: 1920, height: 1080 } },
  }
})

vi.mock('@freecut/shared/host/embedded-host', () => ({
  getEmbeddedHostBridge: () => ({ editingSourceGit: {} }),
}))
vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: harness.project }) },
}))
vi.mock('@freecut/features/editor/deps/timeline-store', () => ({
  useTimelineStore: { getState: () => harness.state },
}))
vi.mock('@freecut/features/media-library/services/media-library-service-loader', () => ({
  importMediaLibraryService: vi.fn(async () => ({ mediaLibraryService: harness.mediaLibraryService })),
}))
vi.mock('@freecut/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: harness.resolveMediaUrl,
}))
vi.mock('@freecut/features/project-source/project-source-worktree', () => ({
  readProjectSource: vi.fn(async () => ({ timeline: { items: [], tracks: [] } })),
}))

import { TIMELINE_AI_TOOLS } from './project-source-ai-tools'

function getTool(name: string) {
  const tool = TIMELINE_AI_TOOLS.find((entry) => entry.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool
}

describe('timeline AI tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.state.items.splice(1)
    harness.state.tracks = [{ id: 'track-video', name: 'V1', kind: 'video', order: 0, locked: false, visible: true, muted: false }]
    harness.state.items[0]!.from = 0
    harness.state.items[0]!.durationInFrames = 300
  })

  it('returns a bounded, semantic project summary', async () => {
    const result = await getTool('project.inspect').execute({ limit: 10 })
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      project: { id: 'project-1', name: 'Demo', fps: 30 },
      items: [{ id: 'clip-1', fromSeconds: 0, toSeconds: 10, mediaId: 'media-1' }],
    })
    expect(result.data).toMatchObject({ project: { durationSeconds: 10 } })
  })

  it('requires explicit trim boundaries', () => {
    expect(getTool('timeline.trim').validate({ itemId: 'clip-1' })).toMatchObject({ ok: false })
  })

  it('returns the newly created right clip after splitting', async () => {
    const rightItem = { ...harness.state.items[0]!, id: 'clip-2', from: 150, durationInFrames: 150 }
    harness.state.splitItem = vi.fn(() => {
      harness.state.items[0]!.durationInFrames = 150
      harness.state.items.push(rightItem)
    })
    harness.state.saveTimeline.mockResolvedValue(undefined)

    const result = await getTool('timeline.split').execute({ itemId: 'clip-1', atSeconds: 5 })

    expect(harness.state.splitItem).toHaveBeenCalledWith('clip-1', 150)
    expect(result.data).toMatchObject({ split: { leftItemId: 'clip-1', rightItemId: 'clip-2' } })
  })

  it('uses timeline actions and persists the semantic edit', async () => {
    harness.state.trimItemStart.mockImplementation((_id: string, amount: number) => {
      harness.state.items[0]!.from += amount
      harness.state.items[0]!.durationInFrames -= amount
    })
    harness.state.saveTimeline.mockResolvedValue(undefined)

    const result = await getTool('timeline.trim').execute({ itemId: 'clip-1', startSeconds: 2 })

    expect(harness.state.trimItemStart).toHaveBeenCalledWith('clip-1', 60)
    expect(harness.state.saveTimeline).toHaveBeenCalledWith('project-1')
    expect(result.data).toMatchObject({
      operation: '裁剪片段',
      before: { item: { fromSeconds: 0, toSeconds: 10 } },
      after: { items: [{ id: 'clip-1', fromSeconds: 2, toSeconds: 10 }] },
    })
  })

  it('adds a media asset through timeline actions and persists the placement', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    const result = await getTool('timeline.add_media').execute({
      mediaId: harness.media.id,
      startSeconds: 12,
    })

    expect(harness.mediaLibraryService.getMediaForProject).toHaveBeenCalledWith('project-1')
    expect(harness.resolveMediaUrl).toHaveBeenCalledWith('media-2')
    expect(harness.state.addItems).toHaveBeenCalledTimes(1)
    expect(harness.state.addItems.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        mediaId: 'media-2',
        trackId: 'track-video',
        from: 360,
        durationInFrames: 120,
      }),
    ])
    expect(harness.state.saveTimeline).toHaveBeenCalledWith('project-1')
    expect(result.data).toMatchObject({
      operation: '添加素材到时间轴',
      before: {
        mediaId: 'media-2',
        actualStartSeconds: 12,
      },
    })
  })
})
