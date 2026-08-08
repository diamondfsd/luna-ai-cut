import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  useItemsStore,
  useTimelineSettingsStore,
} from '@freecut/features/editor/deps/timeline-contract'
import type { ImageItem, TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import { compileEditProgram, compileVisualState, transformForPose } from './compiler'
import { editProgramSchema } from './schema'
import type { EditProgram } from './types'

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
  })

  it('reuses the previous caption track when rebuilding implicit text', async () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'caption-track',
        name: 'V6',
        kind: 'video',
        height: 72,
        order: -5,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        volume: 0,
        items: [],
      },
      ...[-4, -3, -2, -1].map((order, index): TimelineTrack => ({
        id: `stale-caption-track-${index}`,
        name: `V${5 - index}`,
        kind: 'video',
        height: 72,
        order,
        locked: false,
        syncLock: true,
        visible: true,
        muted: false,
        solo: false,
        volume: 0,
        items: [],
      })),
      {
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
      },
    ]
    const previousCaption = {
      id: 'old-caption',
      type: 'text',
      trackId: 'caption-track',
      from: 0,
      durationInFrames: 240,
      label: '旧字幕',
      text: '旧字幕',
    } as TimelineItem
    const picture = {
      ...imageItem(),
      trackId: 'picture-track',
      durationInFrames: 240,
    }
    useItemsStore.setState({ items: [previousCaption, picture], tracks })

    const compiled = await compileEditProgram({
      version: 1,
      baseRevision: 7,
      intent: '重做字幕',
      operations: [
        { type: 'removeClip', clipRef: 'clip:old-caption' },
        { type: 'insertText', text: { ref: 'caption-1', text: '第一句', start: 0, duration: 2, role: 'caption' } },
        { type: 'insertText', text: { ref: 'caption-2', text: '第二句', start: 2, duration: 2, role: 'caption' } },
        { type: 'insertText', text: { ref: 'caption-3', text: '第三句', start: 4, duration: 2, role: 'caption' } },
      ],
    })

    expect(compiled.tracks).toHaveLength(2)
    expect(compiled.tracks.map((track) => track.id)).toEqual(['caption-track', 'picture-track'])
    expect(compiled.insertItems.map((item) => item.trackId)).toEqual([
      'caption-track',
      'caption-track',
      'caption-track',
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
