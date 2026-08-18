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
      sourceWidth: 1920,
      sourceHeight: 1080,
      transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1 },
    }],
    transitions: [],
    keyframes: [],
    trimItemStart: vi.fn(),
    trimItemEnd: vi.fn(),
    splitItem: vi.fn(),
    setTracks: vi.fn(),
    addItem: vi.fn(),
    addItemOnNewTrack: vi.fn(),
    addItems: vi.fn(),
    updateItem: vi.fn((id: string, updates: Record<string, unknown>) => {
      const item = state.items.find((candidate) => candidate.id === id)
      if (item) Object.assign(item, updates)
    }),
    updateItemTransform: vi.fn((id: string, updates: Record<string, unknown>) => {
      const item = state.items.find((candidate) => candidate.id === id)
      if (item) item.transform = { ...item.transform, ...updates }
    }),
    addKeyframe: vi.fn(() => 'keyframe-1'),
    markDirty: vi.fn(),
    saveTimeline: vi.fn(),
  }
  const resolveMediaUrl = vi.fn(async () => 'blob:media-2')
  const captureSnapshot = vi.fn(() => ({}))
  const restoreSnapshot = vi.fn()
  const project = { id: 'project-1', name: 'Demo', duration: 99, metadata: { width: 1920, height: 1080 } }
  const updateProject = vi.fn(async (_id: string, updates: Partial<typeof project.metadata>) => {
    project.metadata = { ...project.metadata, ...updates }
    return project
  })
  return {
    state,
    media,
    mediaLibraryService,
    resolveMediaUrl,
    captureSnapshot,
    restoreSnapshot,
    project,
    updateProject,
  }
})

vi.mock('@freecut/features/editor/deps/projects', () => ({
  useProjectStore: { getState: () => ({ currentProject: harness.project, updateProject: harness.updateProject }) },
}))
vi.mock('@freecut/features/editor/deps/timeline-store', () => ({
  useTimelineStore: { getState: () => harness.state },
  captureSnapshot: harness.captureSnapshot,
  restoreSnapshot: harness.restoreSnapshot,
  useTimelineCommandStore: { getState: () => ({ addUndoEntry: vi.fn() }) },
}))
vi.mock('@freecut/features/media-library/services/media-library-service-loader', () => ({
  importMediaLibraryService: vi.fn(async () => ({ mediaLibraryService: harness.mediaLibraryService })),
}))
vi.mock('@freecut/features/timeline/deps/media-library-resolver', () => ({
  resolveMediaUrl: harness.resolveMediaUrl,
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
    harness.state.items[0]!.transform = { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1 }
    harness.state.keyframes = []
    harness.project.metadata = { width: 1920, height: 1080 }
  })

  it('returns a bounded, semantic project summary', async () => {
    const result = await getTool('project.inspect').execute({ limit: 10 })
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      project: { id: 'project-1', name: 'Demo', fps: 30 },
      items: [{ id: 'clip-1', fromSeconds: 0, toSeconds: 10, mediaId: 'media-1' }],
    })
    expect(result.data).toMatchObject({
      items: [{ transform: { x: 0.5, y: 0.5, width: 1, height: 1, opacity: 1 } }],
    })
    expect(result.data).toMatchObject({ project: { durationSeconds: 10 } })
  })

  it('changes the project canvas through the metadata update flow', async () => {
    const result = await getTool('project.set_canvas').execute({ aspectRatio: '9:16' })

    expect(harness.updateProject).toHaveBeenCalledWith('project-1', { width: 1080, height: 1920 })
    expect(result.data).toMatchObject({
      operation: '修改画布尺寸',
      before: { width: 1920, height: 1080 },
      after: { width: 1080, height: 1920, aspectRatio: '9:16' },
    })
  })

  it('reuses the nearest available subtitle track for text', async () => {
    const subtitleTrack = { id: 'track-subtitle', name: 'S1', kind: 'subtitle', order: -1, locked: false, visible: true, muted: false }
    harness.state.tracks = [subtitleTrack, ...harness.state.tracks]
    harness.state.saveTimeline.mockResolvedValue(undefined)

    await getTool('timeline.add_text').execute({
      text: '你好，世界',
      startSeconds: 2,
      durationSeconds: 3,
    })

    expect(harness.state.addItem).toHaveBeenCalledWith(expect.objectContaining({
      trackId: 'track-subtitle',
      from: 60,
      durationInFrames: 90,
      backgroundColor: undefined,
      backgroundRadius: 0,
      textPadding: 0,
      transform: expect.objectContaining({
        x: 0,
        y: 389,
        width: 1344,
        height: 173,
      }),
    }))
    expect(harness.state.addItemOnNewTrack).not.toHaveBeenCalled()
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

  it('accepts multiple media placements in one batch tool call', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    const result = await getTool('timeline.add_media_batch').execute({
      items: [
        { mediaId: harness.media.id, startSeconds: 12 },
        { mediaId: harness.media.id, startSeconds: 20 },
      ],
    })

    expect(harness.state.addItems).toHaveBeenCalledTimes(2)
    expect(result.data).toMatchObject({
      items: [
        { id: expect.any(String), mediaId: 'media-2', startSeconds: 12, endSeconds: 16, durationSeconds: 4, trackId: 'track-video' },
        { id: expect.any(String), mediaId: 'media-2', startSeconds: 20, endSeconds: 24, durationSeconds: 4, trackId: 'track-video' },
      ],
      operations: [{ mediaId: 'media-2' }, { mediaId: 'media-2' }],
      after: { items: [{ id: 'clip-1' }] },
    })
  })

  it('restores the original timeline when a batch item is invalid', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    await expect(getTool('timeline.add_media_batch').execute({
      items: [
        { mediaId: harness.media.id, startSeconds: 12 },
        { mediaId: harness.media.id, startSeconds: 20, sourceStartSeconds: 3, sourceEndSeconds: 2 },
      ],
    })).rejects.toThrow('sourceEndSeconds 必须大于 sourceStartSeconds')

    expect(harness.restoreSnapshot).toHaveBeenCalled()
    expect(harness.state.addItems).toHaveBeenCalledTimes(1)
  })

  it('adds only the requested source range without a follow-up trim', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    const result = await getTool('timeline.add_media').execute({
      mediaId: harness.media.id,
      startSeconds: 12,
      sourceStartSeconds: 1,
      sourceEndSeconds: 2.5,
    })

    expect(harness.state.addItems.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        trackId: 'track-video',
        from: 360,
        durationInFrames: 45,
        sourceStart: 30,
        sourceEnd: 75,
        sourceDuration: 120,
        sourceFps: 30,
      }),
    ])
    expect(result.data).toMatchObject({
      before: {
        sourceRange: {
          startSeconds: 1,
          endSeconds: 2.5,
          sourceStart: 30,
          sourceEnd: 75,
        },
      },
    })
  })

  it('converts normalized transform values to the editor transform units', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    await getTool('timeline.set_transform').execute({
      itemId: 'clip-1',
      x: 0.5,
      y: 0.75,
      width: 0.8,
      height: 0.4,
      cornerRadius: 0.1,
    })

    expect(harness.state.updateItemTransform).toHaveBeenCalledWith('clip-1', {
      x: 0,
      y: 270,
      width: 1536,
      height: 432,
      cornerRadius: 108,
    })
  })

  it('changes a text box and its font size together when requested', async () => {
    const textItem = {
      ...harness.state.items[0]!,
      id: 'text-1',
      type: 'text' as const,
      text: '标题',
      fontSize: 60,
    }
    harness.state.items.push(textItem)
    harness.state.saveTimeline.mockResolvedValue(undefined)

    await getTool('timeline.set_transform').execute({
      itemId: 'text-1',
      width: 0.85,
      height: 0.35,
      fontSizeRatio: 0.08,
    })

    expect(harness.state.updateItemTransform).toHaveBeenCalledWith('text-1', {
      width: 1632,
      height: 378,
    })
    expect(harness.state.updateItem).toHaveBeenCalledWith('text-1', { fontSize: 86 })
  })

  it('validates normalized keyframe values and converts them before storing', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    expect(getTool('timeline.add_keyframe').validate({
      itemId: 'clip-1',
      property: 'width',
      atSeconds: 0,
      value: 2,
    })).toMatchObject({ ok: false })

    await getTool('timeline.add_keyframe').execute({
      itemId: 'clip-1',
      property: 'width',
      atSeconds: 1,
      value: 0.5,
    })

    expect(harness.state.addKeyframe).toHaveBeenCalledWith('clip-1', 'width', 30, 960, undefined)
  })

  it('uses source-relative normalized values for crop keyframes', async () => {
    harness.state.saveTimeline.mockResolvedValue(undefined)

    await getTool('timeline.add_keyframe').execute({
      itemId: 'clip-1',
      property: 'cropLeft',
      atSeconds: 2,
      value: 0.25,
    })

    expect(harness.state.addKeyframe).toHaveBeenCalledWith('clip-1', 'cropLeft', 60, 480, undefined)
  })

  it('keeps trim path offsets in degrees instead of normalized units', () => {
    expect(getTool('timeline.add_keyframe').validate({
      itemId: 'clip-1',
      property: 'trimPathOffset',
      atSeconds: 0,
      value: 360,
    })).toMatchObject({ ok: true })
    expect(getTool('timeline.add_keyframe').validate({
      itemId: 'clip-1',
      property: 'trimPathOffset',
      atSeconds: 0,
      value: 361,
    })).toMatchObject({ ok: false })
  })
})
