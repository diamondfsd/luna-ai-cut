// @vitest-environment jsdom

import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@freecut/types/project'
import type { TimelineItem } from '@freecut/types/timeline'
import type { MediaMetadata } from '@freecut/types/storage'
import { FreeCutCapabilityProvider } from './freecut-capability-provider'
import { FreeCutRuntime } from './freecut-runtime'

function project(): Project {
  return {
    id: 'project-1',
    name: 'SDK test',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 25 },
    rootFolderName: 'private-source-folder',
    timeline: {
      tracks: [{
        id: 'video-1',
        name: 'Video 1',
        kind: 'video',
        height: 80,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
      }],
      items: [],
      transitions: [],
      keyframes: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
    } as ProjectTimeline,
  }
}

function appendTimelineItems(projectValue: Project, items: readonly TimelineItem[]): void {
  const timelineItems = projectValue.timeline!.items as unknown as TimelineItem[]
  timelineItems.push(...items)
}

function appendMusicTrack(projectValue: Project): void {
  projectValue.timeline!.tracks.push({
    id: 'music-1',
    name: 'Music',
    kind: 'audio',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 2,
  })
}

function linkedProject(): Project {
  const value = project()
  value.timeline!.tracks.push({
    id: 'audio-1',
    name: 'A1',
    kind: 'audio',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 1,
  })
  appendTimelineItems(value, [
    {
      id: 'video-1',
      type: 'video',
      trackId: 'video-1',
      from: 0,
      durationInFrames: 100,
      label: 'video',
      mediaId: 'media-1',
      src: '',
      linkedGroupId: 'pair-1',
      volume: 0,
    } as TimelineItem,
    {
      id: 'audio-item-1',
      type: 'audio',
      trackId: 'audio-1',
      from: 0,
      durationInFrames: 100,
      label: 'audio',
      mediaId: 'media-1',
      src: '',
      linkedGroupId: 'pair-1',
      volume: 0,
    } as TimelineItem,
  ])
  return value
}

function musicProject(): Project {
  const value = project()
  value.timeline!.tracks.push({
    id: 'music-1',
    name: 'Music',
    kind: 'audio',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 1,
  })
  appendTimelineItems(value, [{
    id: 'music-item-1',
    type: 'audio',
    trackId: 'music-1',
    from: 0,
    durationInFrames: 750,
    label: 'music',
    mediaId: 'audio-1',
    src: '',
    volume: 0,
  } as TimelineItem])
  return value
}

const media: MediaMetadata = {
  id: 'media-1',
  fileName: 'clip.mp4',
  fileSize: 1,
  mimeType: 'video/mp4',
  duration: 4,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  bitrate: 1,
  audioCodec: 'aac',
  tags: [],
  storageType: 'workspace',
  createdAt: 0,
  updatedAt: 0,
} as MediaMetadata

const audioMedia: MediaMetadata = {
  ...media,
  id: 'audio-1',
  fileName: 'voice.wav',
  mimeType: 'audio/wav',
  duration: 2,
  width: 0,
  height: 0,
  fps: 0,
  codec: 'pcm_s16le',
  audioCodec: undefined,
} as MediaMetadata

const imageMedia: MediaMetadata = {
  ...media,
  id: 'image-1',
  fileName: 'still.png',
  mimeType: 'image/png',
  duration: 1,
  width: 1280,
  height: 720,
  fps: 0,
  audioCodec: undefined,
} as MediaMetadata

const analyzedMedia: MediaMetadata = {
  ...media,
  fileHandle: {} as FileSystemFileHandle,
  opfsPath: 'content/private/media-1/data',
  previewAudioOpfsPath: 'cache/private/media-1.wav',
  aiCaptions: [{
    timeSec: 0,
    text: 'A bright scene',
    embedding: [0.1, 0.2],
    thumbRelPath: 'cache/thumb.jpg',
  }],
} as MediaMetadata

const longVideoMedia: MediaMetadata = {
  ...media,
  id: 'long-video-1',
  duration: 5_814,
  fileSize: 1_780_000_000,
} as MediaMetadata

describe('FreeCutRuntime SDK adapter', () => {
  it('accepts structured project inspection parameters and omits hidden project data', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [analyzedMedia, audioMedia] })

    const result = await runtime.executeSdkCapability('project.inspect', {
      projectId: 'project-1',
      includeTimeline: false,
      includeMedia: true,
    }) as {
      projectId: string
      project: Project
      timeline?: Project['timeline']
      media?: MediaMetadata[]
    }

    expect(result.projectId).toBe('project-1')
    expect(result.timeline).toBeUndefined()
    expect(result.project.timeline).toBeUndefined()
    expect(result.project.rootFolderName).toBeUndefined()
    expect(result.media).toHaveLength(2)
    expect(result.media?.[0]).not.toHaveProperty('fileHandle')
    expect(result.media?.[0]).not.toHaveProperty('opfsPath')
  })

  it('supports structured media list filters, pagination, and a safe metadata shape', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [analyzedMedia, audioMedia, imageMedia] })

    const result = await runtime.executeSdkCapability('media.list', {
      projectId: 'project-1',
      kind: 'video',
      query: 'clip',
      offset: 0,
      limit: 1,
    }) as { media: MediaMetadata[]; total: number }

    expect(result.total).toBe(1)
    expect(result.media).toHaveLength(1)
    expect(result.media[0]).toMatchObject({ id: 'media-1', fileName: 'clip.mp4', mimeType: 'video/mp4' })
    expect(result.media[0]).not.toHaveProperty('fileHandle')
    expect(result.media[0]).not.toHaveProperty('opfsPath')
    expect(result.media[0]).not.toHaveProperty('aiCaptions')
  })

  it('keeps singular media.read and legacy batch media.read result shapes distinct', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [analyzedMedia, audioMedia] })

    const single = await runtime.executeSdkCapability('media.read', {
      projectId: 'project-1',
      mediaId: 'media-1',
    }) as { media: MediaMetadata; items?: MediaMetadata[] }
    expect(Object.keys(single)).toEqual(['media'])
    expect(single.media.aiCaptions).toEqual([{ timeSec: 0, text: 'A bright scene' }])
    expect(single.media).not.toHaveProperty('fileHandle')
    expect(single.media).not.toHaveProperty('opfsPath')

    const batch = await runtime.executeSdkCapability('media.read', {
      projectId: 'project-1',
      mediaIds: ['media-1', 'audio-1'],
    }) as { media: MediaMetadata; items: MediaMetadata[] }
    expect(Object.keys(batch).sort()).toEqual(['items', 'media'])
    expect(batch.items.map((item) => item.id)).toEqual(['media-1', 'audio-1'])
  })

  it('rejects context and input errors without routing AI or audio calls to transcript search', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [analyzedMedia] })

    await expect(runtime.executeSdkCapability('project.inspect', { projectId: 'other-project' }))
      .rejects.toMatchObject({ code: 'PROJECT_CONTEXT_MISMATCH' })
    await expect(runtime.executeSdkCapability('media.list', { limit: 0 }))
      .rejects.toThrow('limit must be greater than zero')
    await expect(runtime.executeSdkCapability('media.read', { projectId: 'project-1' }))
      .rejects.toThrow('mediaId or mediaIds must be provided')
    await expect(runtime.executeSdkCapability('media.read', { mediaId: 'missing' }))
      .rejects.toThrow('Media "missing" does not exist')

    await expect(runtime.executeSdkCapability('media.analyze', {
      mediaId: 'media-1',
      kinds: ['transcript'],
    })).rejects.toThrow('kind must be transcript or visual')
    await expect(runtime.executeSdkCapability('media.analyze', {
      projectId: 'other-project',
      mediaId: 'media-1',
      kind: 'transcript',
    })).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_MISMATCH' })
    const missingTask = await runtime.executeSdkCapability('media.analyze', {
      projectId: 'project-1',
      mediaIds: ['missing'],
      kind: 'transcript',
    }) as { status: string; missingIds: string[]; error?: string }
    expect(missingTask.status).toBe('failed')
    expect(missingTask.missingIds).toEqual(['missing'])
    expect(missingTask.error).toBeTruthy()
    await expect(runtime.executeSdkCapability('audio.start_music', {
      prompt: 'ambient',
      durationSeconds: 1,
    })).rejects.toThrow('durationSeconds must be between 2 and 30')
  })

  it('requires transcript-selected ranges before visual analysis of a long video', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [longVideoMedia] })

    await expect(runtime.executeSdkCapability('media.analyze', {
      projectId: 'project-1',
      mediaIds: [longVideoMedia.id],
      kind: 'visual',
    })).rejects.toThrow('先完成 transcript 分析')

    await expect(runtime.executeSdkCapability('media.analyze', {
      projectId: 'project-1',
      mediaIds: [longVideoMedia.id],
      kind: 'visual',
      timeRanges: [{ startSeconds: 0, endSeconds: 61 }],
    })).rejects.toThrow('at most 60 seconds')
  })

  it('explains that visual time ranges are single-video only', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [analyzedMedia, longVideoMedia] })

    await expect(runtime.executeSdkCapability('media.analyze', {
      projectId: 'project-1',
      mediaIds: [analyzedMedia.id, longVideoMedia.id],
      kind: 'visual',
      timeRanges: [{ startSeconds: 0, endSeconds: 30 }],
    })).rejects.toThrow('timeRanges 只支持单个视频')
  })

  it('deduplicates an in-flight visual analysis with the same source ranges', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [longVideoMedia] })
    const request = {
      projectId: 'project-1',
      mediaIds: [longVideoMedia.id],
      kind: 'visual' as const,
      timeRanges: [{ startSeconds: 0, endSeconds: 30 }],
    }

    const first = await runtime.executeSdkCapability('media.analyze', request) as { taskId: string }
    const second = await runtime.executeSdkCapability('media.analyze', request) as { taskId: string }

    expect(second.taskId).toBe(first.taskId)
  })

  it('routes legacy editing calls through the real headless actions', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [media] })

    const added = await runtime.executeSdkCapability('timeline.add_media', {
      mediaId: media.id,
      startSeconds: 0,
      sourceStartSeconds: 0.5,
      sourceEndSeconds: 2.5,
    }) as { project: Project }
    const video = added.project.timeline!.items.find((item) => item.type === 'video')!
    expect(video).toMatchObject({
      mediaId: media.id,
      durationInFrames: 50,
      sourceStart: 15,
      sourceEnd: 75,
      sourceFps: 30,
    })

    const trimmed = await runtime.executeSdkCapability('timeline.trim', {
      itemId: video.id,
      endSeconds: 1.5,
    }) as { project: Project }
    expect(trimmed.project.timeline!.items.find((item) => item.id === video.id)?.durationInFrames).toBe(38)

    const split = await runtime.executeSdkCapability('timeline.split', {
      itemId: video.id,
      atSeconds: 0.75,
    }) as { project: Project }
    const pieces = split.project.timeline!.items.filter((item) => item.type === 'video')
    expect(pieces).toHaveLength(2)

    const effectResult = await runtime.executeSdkCapability('timeline.effects.add', {
      clipId: pieces[0]!.id,
      type: 'gpu-brightness',
      params: { amount: 0.2 },
    }) as { project: Project }
    const effectItem = effectResult.project.timeline!.items.find((item) => item.id === pieces[0]!.id) as { effects?: unknown[] }
    expect(effectItem.effects).toHaveLength(1)

    const keyframeResult = await runtime.executeSdkCapability('timeline.keyframes.add', {
      clipId: pieces[0]!.id,
      property: 'opacity',
      at: { seconds: 0.25 },
      value: 0.5,
    }) as { project: Project }
    expect(keyframeResult.project.timeline!.keyframes?.some((group) => group.itemId === pieces[0]!.id)).toBe(true)

    const transitionResult = await runtime.executeSdkCapability('timeline.add_transition', {
      fromClipId: pieces[0]!.id,
      toClipId: pieces[1]!.id,
      type: 'crossfade',
      durationSeconds: 0.25,
      presentation: 'fade',
    }) as { project: Project }
    expect(transitionResult.project.timeline!.transitions).toHaveLength(1)
    const transition = transitionResult.project.timeline!.transitions?.[0]
    expect(transition).toBeDefined()
    expect(transition!).toMatchObject({
      leftClipId: pieces[0]!.id,
      rightClipId: pieces[1]!.id,
      presentation: 'fade',
    })
  })

  it('rejects the old fade transition type instead of translating it', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [media] })
    const leftResult = await runtime.executeSdkCapability('timeline.add_media', {
      mediaId: media.id,
      startSeconds: 0,
      sourceStartSeconds: 0,
      sourceEndSeconds: 2,
    }) as { project: Project }
    const rightResult = await runtime.executeSdkCapability('timeline.add_media', {
      mediaId: media.id,
      startSeconds: 2,
      sourceStartSeconds: 0,
      sourceEndSeconds: 2,
    }) as { project: Project }
    const leftClip = leftResult.project.timeline!.items.find((item) => item.type === 'video')!
    const rightClip = rightResult.project.timeline!.items.find((item) => item.type === 'video' && item.id !== leftClip.id)!

    await expect(runtime.executeSdkCapability('timeline.add_transition', {
      fromClipId: leftClip.id,
      toClipId: rightClip.id,
      type: 'fade',
      durationSeconds: 0.25,
    })).rejects.toThrow('Unsupported transition type "fade"')
  })

  it('mutes the actual linked companion audio when addressed by its video item', async () => {
    const runtime = new FreeCutRuntime({ project: linkedProject(), media: [media] })

    const result = await runtime.executeSdkCapability('timeline.mute', {
      itemIds: ['video-1'],
    }) as { project: Project; mutedIds: string[]; volumeDb: number }

    expect(result.volumeDb).toBe(-60)
    expect(result.mutedIds).toEqual(['video-1', 'audio-item-1'])
    expect(result.project.timeline!.items.find((item) => item.id === 'video-1')?.volume).toBe(-60)
    expect(result.project.timeline!.items.find((item) => item.id === 'audio-item-1')?.volume).toBe(-60)
  })

  it('automatically unlinks a companion before removal without removing the video', async () => {
    const runtime = new FreeCutRuntime({ project: linkedProject(), media: [media] })

    const removed = await runtime.executeSdkCapability('timeline.remove', { itemIds: ['audio-item-1'] }) as { project: Project }
    const video = removed.project.timeline!.items.find((item) => item.id === 'video-1')

    expect(video).toMatchObject({ embeddedAudioMuted: true })
    expect(removed.project.timeline!.items.some((item) => item.id === 'audio-item-1')).toBe(false)
  })

  it('removes original audio by video id and keeps the video', async () => {
    const runtime = new FreeCutRuntime({ project: linkedProject(), media: [media] })

    const removed = await runtime.executeSdkCapability('timeline.remove_audio', {
      itemIds: ['video-1'],
    }) as { project: Project; removedAudioIds: string[] }

    expect(removed.removedAudioIds).toEqual(['audio-item-1'])
    expect(removed.project.timeline!.items.find((item) => item.id === 'video-1')).toMatchObject({
      embeddedAudioMuted: true,
    })
    expect(removed.project.timeline!.items.some((item) => item.id === 'audio-item-1')).toBe(false)
  })

  it('removes standalone music by audio id', async () => {
    const runtime = new FreeCutRuntime({ project: musicProject(), media: [audioMedia] })

    const removed = await runtime.executeSdkCapability('timeline.remove_audio', {
      itemIds: ['music-item-1'],
    }) as { project: Project; removedAudioIds: string[] }

    expect(removed.removedAudioIds).toEqual(['music-item-1'])
    expect(removed.project.timeline!.items).toHaveLength(0)
  })

  it('fits standalone music to the visual timeline without touching linked original audio', async () => {
    const value = linkedProject()
    appendMusicTrack(value)
    appendTimelineItems(value, [{
      id: 'music-item-1',
      type: 'audio',
      trackId: 'music-1',
      from: 0,
      durationInFrames: 150,
      label: 'music',
      mediaId: 'audio-1',
      src: '',
      volume: 0,
    } as TimelineItem])
    const runtime = new FreeCutRuntime({ project: value, media: [media, audioMedia] })

    const fitted = await runtime.executeSdkCapability('timeline.fit_audio_to_visual', {}) as {
      project: Project
      visualEndSeconds: number
      trimmedAudioIds: string[]
      removedAudioIds: string[]
    }

    expect(fitted.visualEndSeconds).toBe(100 / 25)
    expect(fitted.trimmedAudioIds).toEqual(['music-item-1'])
    expect(fitted.removedAudioIds).toEqual([])
    expect(fitted.project.timeline!.items.find((item) => item.id === 'music-item-1')).toMatchObject({
      from: 0,
      durationInFrames: 100,
    })
    expect(fitted.project.timeline!.items.find((item) => item.id === 'audio-item-1')).toMatchObject({
      from: 0,
      durationInFrames: 100,
    })
  })

  it('removes standalone audio that starts after the visual timeline', async () => {
    const value = project()
    value.timeline!.tracks.push({
      id: 'audio-1',
      name: 'Music',
      kind: 'audio',
      height: 64,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
    })
    appendTimelineItems(value, [{
      id: 'music-item-1',
      type: 'audio',
      trackId: 'audio-1',
      from: 120,
      durationInFrames: 30,
      label: 'music',
      mediaId: 'audio-1',
      src: '',
      volume: 0,
    } as TimelineItem])
    appendTimelineItems(value, [{
      id: 'video-item-1',
      type: 'image',
      trackId: 'video-1',
      from: 0,
      durationInFrames: 60,
      label: 'image',
      mediaId: 'image-1',
      src: '',
    } as TimelineItem])
    const runtime = new FreeCutRuntime({ project: value, media: [audioMedia] })

    const fitted = await runtime.executeSdkCapability('timeline.fit_audio_to_visual', {}) as {
      project: Project
      removedAudioIds: string[]
    }

    expect(fitted.removedAudioIds).toEqual(['music-item-1'])
    expect(fitted.project.timeline!.items.some((item) => item.id === 'music-item-1')).toBe(false)
  })

  it('creates video and audio tracks through the provider and targets them from text and media edits', async () => {
    const runtime = new FreeCutRuntime({ project: project(), media: [audioMedia] })
    const provider = new FreeCutCapabilityProvider(runtime)

    const videoResult = await provider.execute('timeline.add_track', { type: 'video' }) as {
      project: Project
      createdIds: string[]
    }
    const videoTrackId = videoResult.createdIds[0]!
    expect(videoResult.project.timeline!.tracks.find((track) => track.id === videoTrackId)).toMatchObject({
      kind: 'video',
    })

    const textResult = await runtime.executeSdkCapability('timeline.add_text', {
      text: 'on the new video track',
      startSeconds: 0,
      durationSeconds: 1,
      trackId: videoTrackId,
    }) as { project: Project }
    expect(textResult.project.timeline!.items.find((item) => item.type === 'text')).toMatchObject({
      trackId: videoTrackId,
      text: 'on the new video track',
    })

    const audioResult = await provider.execute('timeline.add_track', { type: 'audio' }) as {
      project: Project
      createdIds: string[]
    }
    const audioTrackId = audioResult.createdIds[0]!
    expect(audioResult.project.timeline!.tracks.find((track) => track.id === audioTrackId)).toMatchObject({
      kind: 'audio',
    })

    const mediaResult = await runtime.executeSdkCapability('timeline.add_media', {
      mediaId: audioMedia.id,
      startSeconds: 1,
      durationSeconds: 1,
      trackId: audioTrackId,
    }) as { project: Project }
    expect(mediaResult.project.timeline!.items.find((item) => item.type === 'audio')).toMatchObject({
      mediaId: audioMedia.id,
      trackId: audioTrackId,
    })
  })

  it('moves a video overlay track above its reference track', async () => {
    const runtime = new FreeCutRuntime({ project: project() })
    const provider = new FreeCutCapabilityProvider(runtime)

    const firstOverlay = await provider.execute('timeline.add_track', { type: 'video' }) as {
      createdIds: string[]
    }
    const secondOverlay = await provider.execute('timeline.add_track', { type: 'video' }) as {
      createdIds: string[]
    }
    const baseTrackId = 'video-1'
    const firstOverlayId = firstOverlay.createdIds[0]!
    const secondOverlayId = secondOverlay.createdIds[0]!

    const moved = await provider.execute('timeline.move_track', {
      trackId: baseTrackId,
      aboveTrackId: secondOverlayId,
    }) as { project: Project; affectedIds: string[] }

    const tracks = moved.project.timeline!.tracks
    const baseTrack = tracks.find((track) => track.id === baseTrackId)!
    const firstOverlayTrack = tracks.find((track) => track.id === firstOverlayId)!
    const secondOverlayTrack = tracks.find((track) => track.id === secondOverlayId)!
    expect(baseTrack.order).toBeLessThan(secondOverlayTrack.order)
    expect(secondOverlayTrack.order).toBeLessThan(firstOverlayTrack.order)
    expect(moved.affectedIds).toContain(baseTrackId)
  })
})
