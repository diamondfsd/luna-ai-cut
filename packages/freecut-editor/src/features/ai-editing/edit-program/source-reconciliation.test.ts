import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  useItemsStore,
  useTimelineSettingsStore,
} from '@freecut/features/editor/deps/timeline-contract'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import type { MediaMetadata } from '@freecut/types/storage'
import type { TimelineTrack } from '@freecut/types/timeline'
import { compileEditProgram } from './compiler'
import type { EditProgram } from './types'

vi.mock('@freecut/features/editor/deps/media-library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@freecut/features/editor/deps/media-library')>()),
  resolveMediaUrl: vi.fn(async () => 'blob:video'),
}))

function videoTrack(): TimelineTrack {
  return {
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
  }
}

function videoMedia(audioCodec?: string): MediaMetadata {
  return {
    id: 'video-media',
    fileName: 'source.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 1_000_000,
    ...(audioCodec ? { audioCodec } : {}),
  } as MediaMetadata
}

describe('AI editing source reconciliation', () => {
  beforeEach(() => {
    useTimelineSettingsStore.setState({ fps: 30, changeVersion: 7, isDirty: false })
    useItemsStore.setState({ items: [], tracks: [] })
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
  })

  it('keeps source audio when compiling a video clip', async () => {
    const track = videoTrack()
    const media = videoMedia('aac')
    useItemsStore.setState({ tracks: [track], items: [] })
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
            trackRef: `track:${track.id}`,
            start: 0,
            duration: 3,
          },
        },
      ],
    })

    expect(compiled.insertItems.map((item) => item.type)).toEqual(['video', 'audio'])
    expect(compiled.insertItems[0]?.linkedGroupId).toBeTruthy()
    expect(compiled.insertItems[1]?.linkedGroupId).toBe(compiled.insertItems[0]?.linkedGroupId)
    expect(
      compiled.tracks.find((candidate) => candidate.id === compiled.insertItems[1]?.trackId)?.kind,
    ).toBe('audio')
  })

  it('reconciles persisted source refs instead of replaying inserts across sessions', async () => {
    const track = videoTrack()
    const media = videoMedia('aac')
    useItemsStore.setState({ tracks: [track], items: [] })
    useMediaLibraryStore.setState({ mediaItems: [media], mediaById: { [media.id]: media } })
    const program: EditProgram = {
      version: 1,
      baseRevision: 7,
      sourceProjectId: 'project-1',
      intent: '持久化剪辑源码',
      operations: [
        {
          type: 'insertClip',
          clip: {
            ref: 'opening-shot',
            mediaRef: `media:${media.id}`,
            trackRef: `track:${track.id}`,
            start: 0,
            duration: 3,
          },
        },
      ],
    }

    const first = await compileEditProgram(program)
    expect(first.insertItems[0]?.aiEditingSource).toEqual({
      projectId: 'project-1',
      ref: 'opening-shot',
      role: 'primary',
    })

    useItemsStore.setState({ tracks: first.tracks, items: first.insertItems })
    const rebuilt = await compileEditProgram(program)
    expect(rebuilt.removeIds).toEqual(first.insertItems.map((item) => item.id))
    expect(rebuilt.insertItems).toHaveLength(2)
    expect(rebuilt.insertItems[0]?.aiEditingSource?.ref).toBe('opening-shot')

    const removedFromSource = await compileEditProgram({ ...program, operations: [] })
    expect(removedFromSource.removeIds).toEqual(first.insertItems.map((item) => item.id))
    expect(removedFromSource.insertItems).toEqual([])
  })

  it('treats a persisted removal as desired absence after the first publish', async () => {
    const track = videoTrack()
    const item = {
      id: 'existing-image',
      type: 'image' as const,
      src: 'blob:image',
      trackId: track.id,
      from: 0,
      durationInFrames: 30,
      label: 'Existing image',
    }
    useItemsStore.setState({ tracks: [track], items: [item] })
    const program: EditProgram = {
      version: 1,
      baseRevision: 7,
      sourceProjectId: 'project-1',
      intent: '移除不需要的画面',
      operations: [{ type: 'removeClip', clipRef: `clip:${item.id}` }],
    }

    expect((await compileEditProgram(program)).removeIds).toEqual([item.id])
    useItemsStore.setState({ tracks: [track], items: [] })
    expect((await compileEditProgram(program)).removeIds).toEqual([])
  })
})
