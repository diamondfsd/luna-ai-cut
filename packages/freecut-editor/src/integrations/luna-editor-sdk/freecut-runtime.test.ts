// @vitest-environment jsdom

import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@freecut/types/project'
import type { MediaMetadata } from '@freecut/types/storage'
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
  aiCaptions: [{ timeSec: 0, text: 'A bright scene' }],
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
    }) as { project: Project }
    expect(transitionResult.project.timeline!.transitions).toHaveLength(1)
    expect(transitionResult.project.timeline!.transitions[0]).toMatchObject({
      leftClipId: pieces[0]!.id,
      rightClipId: pieces[1]!.id,
    })
  })
})
