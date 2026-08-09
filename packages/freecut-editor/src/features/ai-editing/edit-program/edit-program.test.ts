import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  useItemsStore,
  useTimelineSettingsStore,
} from '@freecut/features/editor/deps/timeline-contract'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import type { MediaMetadata } from '@freecut/types/storage'
import type { ImageItem, TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import {
  compileEditProgram,
  compileVisualState,
  resolveAiLinkedAudioPlacement,
  transformForPose,
} from './compiler'
import { editProgramSchema } from './schema'
import type { EditProgram } from './types'

vi.mock('@freecut/features/editor/deps/media-library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@freecut/features/editor/deps/media-library')>()),
  resolveMediaUrl: vi.fn(async () => 'blob:video'),
}))

function imageItem(): ImageItem {
  return {
    id: 'image-1',
    type: 'image',
    src: 'blob:image',
    mediaId: 'media-1',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: 'UI',
    sourceWidth: 1920,
    sourceHeight: 1200,
  }
}

describe('EditProgram', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30, changeVersion: 7, isDirty: false })
    useItemsStore.setState({ items: [], tracks: [] })
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
  })

  it('keeps source audio when compiling a video clip', async () => {
    const videoTrack = {
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      height: 64,
      order: 0,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      items: [],
    } satisfies TimelineTrack
    const media = {
      id: 'video-media',
      fileName: 'source.mp4',
      fileSize: 1024,
      mimeType: 'video/mp4',
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
      audioCodec: 'aac',
      bitrate: 1_000_000,
    } as MediaMetadata
    useItemsStore.setState({ tracks: [videoTrack], items: [] })
    useMediaLibraryStore.setState({ mediaItems: [media], mediaById: { [media.id]: media } })

    const compiled = await compileEditProgram({
      version: 1,
      baseRevision: 7,
      intent: '剪入带原声的视频',
      operations: [
        {
          type: 'insertClip',
          clip: {
            ref: 'shot-1',
            mediaRef: `media:${media.id}`,
            trackRef: `track:${videoTrack.id}`,
            start: 0,
            duration: 3,
          },
        },
      ],
    })

    expect(compiled.insertItems.map((item) => item.type)).toEqual(['video', 'audio'])
    expect(compiled.insertItems[0]?.linkedGroupId).toBeTruthy()
    expect(compiled.insertItems[1]?.linkedGroupId).toBe(compiled.insertItems[0]?.linkedGroupId)
    const audioTrack = compiled.tracks.find(
      (track) => track.id === compiled.insertItems[1]?.trackId,
    )
    expect(audioTrack?.kind).toBe('audio')
  })

  it('creates a separate audio track when every existing audio lane overlaps', () => {
    const videoTrack = {
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      height: 64,
      order: 0,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      items: [],
    } satisfies TimelineTrack
    const audioTrack = { ...videoTrack, id: 'audio-track', name: 'A1', kind: 'audio' as const, order: 1 }
    const occupiedAudio = {
      id: 'audio-existing',
      type: 'audio',
      trackId: audioTrack.id,
      from: 0,
      durationInFrames: 120,
      label: 'Existing audio',
      src: 'blob:audio',
    } satisfies TimelineItem

    const placement = resolveAiLinkedAudioPlacement({
      tracks: [videoTrack, audioTrack],
      items: [occupiedAudio],
      from: 30,
      durationInFrames: 240,
    })

    expect(placement.trackId).not.toBe(audioTrack.id)
    expect(placement.tracks.find((track) => track.id === placement.trackId)?.kind).toBe('audio')
  })

  it('rejects AI text that explicitly targets a video track', async () => {
    const track = {
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      height: 64,
      order: 0,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      items: [],
    } satisfies TimelineTrack
    useItemsStore.setState({
      tracks: [track],
      items: [{ ...imageItem(), trackId: track.id, from: 0, durationInFrames: 120 }],
    })

    await expect(
      compileEditProgram({
        version: 1,
        baseRevision: 7,
        intent: '添加重叠文字',
        operations: [
          {
            type: 'insertText',
            text: {
              ref: 'overlap-title',
              text: 'Title',
              start: 1,
              duration: 2,
              trackRef: 'track:video-track',
            },
          },
        ],
      }),
    ).rejects.toThrow('素材不能放入轨道“V1”')
  })

  it('compiles caption text into a dedicated subtitle track', async () => {
    const videoTrack = {
      id: 'video-track',
      name: 'V1',
      kind: 'video',
      height: 64,
      order: 0,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      items: [],
    } satisfies TimelineTrack
    useItemsStore.setState({ tracks: [videoTrack], items: [] })

    const compiled = await compileEditProgram({
      version: 1,
      baseRevision: 7,
      intent: '添加字幕',
      operations: [
        {
          type: 'insertText',
          text: { ref: 'caption-1', text: '字幕内容', start: 0, duration: 2, role: 'caption' },
        },
      ],
    })

    expect(compiled.insertItems[0]).toMatchObject({
      type: 'subtitle',
      cues: [{ text: '字幕内容', startSeconds: 0, endSeconds: 2 }],
    })
    const subtitleTrack = compiled.tracks.find(
      (track) => track.id === compiled.insertItems[0]?.trackId,
    )
    expect(subtitleTrack?.kind).toBe('subtitle')
    expect(subtitleTrack?.order).toBeLessThan(videoTrack.order)
  })

  it('reuses one dedicated text track for sequential plain text', async () => {
    const tracks: TimelineTrack[] = [{
      id: 'picture-track',
      name: 'V1',
      kind: 'video',
      height: 72,
      order: 0,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      volume: 0,
      items: [],
    }]
    const picture = {
      ...imageItem(),
      trackId: 'picture-track',
      durationInFrames: 240,
    }
    useItemsStore.setState({ items: [picture], tracks })

    const compiled = await compileEditProgram({
      version: 1,
      baseRevision: 7,
      intent: '重做字幕',
      operations: [
        { type: 'insertText', text: { ref: 'caption-1', text: '第一句', start: 0, duration: 2 } },
        { type: 'insertText', text: { ref: 'caption-2', text: '第二句', start: 2, duration: 2 } },
        { type: 'insertText', text: { ref: 'caption-3', text: '第三句', start: 4, duration: 2 } },
      ],
    })

    const textTrack = compiled.tracks.find((track) => track.kind === 'subtitle')
    expect(textTrack).toBeDefined()
    expect(textTrack?.order).toBeLessThan(0)
    expect(compiled.insertItems.map((item) => item.trackId)).toEqual([
      textTrack?.id,
      textTrack?.id,
      textTrack?.id,
    ])
  })

  it('reuses an adjacent text track without moving unrelated text', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'remote-text-track',
        name: 'S1',
        kind: 'subtitle',
        height: 72,
        order: -2,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        items: [],
      },
      {
        id: 'adjacent-text-track',
        name: 'S2',
        kind: 'subtitle',
        height: 72,
        order: -1,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        items: [],
      },
      {
        id: 'picture-track',
        name: 'V1',
        kind: 'video',
        height: 72,
        order: 0,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        items: [],
      },
    ]
    const remoteText = {
      id: 'remote-text',
      type: 'text',
      trackId: 'remote-text-track',
      from: 0,
      durationInFrames: 240,
      label: '保留标题',
      text: '保留标题',
    } as TimelineItem
    const adjacentCaption = {
      id: 'adjacent-caption',
      type: 'text',
      trackId: 'adjacent-text-track',
      from: 0,
      durationInFrames: 60,
      label: '已有字幕',
      text: '已有字幕',
    } as TimelineItem
    const picture = { ...imageItem(), trackId: 'picture-track', durationInFrames: 240 }
    useItemsStore.setState({ items: [remoteText, adjacentCaption, picture], tracks })

    const compiled = await compileEditProgram({
      version: 1,
      baseRevision: 7,
      intent: '补充字幕',
      operations: [
        { type: 'insertText', text: { ref: 'caption-2', text: '新增字幕', start: 2, duration: 2 } },
      ],
    })

    expect(compiled.insertItems[0]?.trackId).toBe('adjacent-text-track')
    expect(compiled.removeIds).toEqual([])
    expect(compiled.tracks.map((track) => track.id)).toEqual([
      'remote-text-track',
      'adjacent-text-track',
      'picture-track',
    ])
  })

  it('rejects malformed framing before compilation', () => {
    const result = editProgramSchema.safeParse({
      version: 1,
      baseRevision: 7,
      intent: '制作特写',
      operations: [{
        type: 'insertClip',
        clip: {
          ref: 'shot-1',
          mediaRef: 'media:ui',
          trackRef: 'track:v1',
          start: 0,
          duration: 2,
          framing: { mode: 'cover', pose: { center: [1.2, 0.5], zoom: 0.5 } },
        },
      }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a stale program before resolving any operation', async () => {
    const program: EditProgram = {
      version: 1,
      baseRevision: 6,
      intent: '删除旧片段',
      operations: [{ type: 'removeClip', clipRef: 'clip:missing' }],
    }
    await expect(compileEditProgram(program)).rejects.toThrow('最新编辑空间')
  })

  it('maps different normalized focal points to different canvas transforms', () => {
    const common = {
      mode: 'cover' as const,
      sourceWidth: 1920,
      sourceHeight: 1200,
      canvasWidth: 1920,
      canvasHeight: 1080,
    }
    const top = transformForPose({ ...common, pose: { center: [0.5, 0.15], zoom: 1.8 } })
    const sidebar = transformForPose({ ...common, pose: { center: [0.15, 0.5], zoom: 2.2 } })
    const timeline = transformForPose({ ...common, pose: { center: [0.5, 0.85], zoom: 1.9 } })

    expect(new Set([`${top.x}:${top.y}`, `${sidebar.x}:${sidebar.y}`, `${timeline.x}:${timeline.y}`])).toHaveLength(3)
    expect(sidebar.width).not.toBe(top.width)
  })

  it('compiles camera movement into a persistent motion layer with real deltas', () => {
    const updates = compileVisualState({
      item: imageItem(),
      framing: { mode: 'cover', pose: { center: [0.2, 0.3], zoom: 1.8 } },
      cameraMove: {
        type: 'move',
        from: { center: [0.2, 0.3], zoom: 1.8 },
        to: { center: [0.7, 0.75], zoom: 2.4 },
        easing: 'ease-out',
      },
      canvasWidth: 1920,
      canvasHeight: 1080,
    })

    const layer = updates.motionLayers?.find((candidate) => candidate.sourcePresetId === 'ai-edit-program')
    expect(layer).toBeDefined()
    expect(layer?.tracks.find((track) => track.property === 'x')?.keyframes.at(-1)?.value).not.toBe(0)
    expect(layer?.tracks.find((track) => track.property === 'y')?.keyframes.at(-1)?.value).not.toBe(0)
    expect(layer?.tracks.find((track) => track.property === 'width')?.keyframes.at(-1)?.value).toBeGreaterThan(1)
  })
})
