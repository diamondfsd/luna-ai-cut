// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@freecut/types/project'
import { validateAiEditingTimelineSource } from './timeline-source-validation'

function projectWith(items: NonNullable<Project['timeline']>['items'], options: {
  subtitleOrder?: number
} = {}): Project {
  return {
    id: 'project-1',
    name: 'test',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 10,
    metadata: { width: 1920, height: 1080, fps: 30 },
    timeline: {
      tracks: [
        {
          id: 'subtitle', name: '旁白', kind: 'subtitle', order: options.subtitleOrder ?? -1,
          height: 40, locked: false, visible: true, muted: false, solo: false,
        },
        {
          id: 'video', name: 'V1', kind: 'video', order: 0,
          height: 60, locked: false, visible: true, muted: false, solo: false,
        },
        {
          id: 'audio', name: 'A1', kind: 'audio', order: 1,
          height: 60, locked: false, visible: true, muted: false, solo: false,
        },
      ],
      items,
    },
  }
}

const video = {
  id: 'video-1', trackId: 'video', type: 'video' as const, label: '镜头 1',
  from: 0, durationInFrames: 150, mediaId: 'media-1', src: 'media:media-1',
  linkedGroupId: 'pair-1', sourceStart: 0, sourceEnd: 150,
}

const audio = {
  id: 'audio-1', trackId: 'audio', type: 'audio' as const, label: '镜头 1 音频',
  from: 0, durationInFrames: 150, mediaId: 'media-1', src: 'media:media-1',
  linkedGroupId: 'pair-1', sourceStart: 0, sourceEnd: 150,
}

const text = {
  id: 'text-1', trackId: 'subtitle', type: 'text' as const, label: '旁白字幕',
  from: 0, durationInFrames: 90, text: '测试字幕', transform: { x: 0, y: 360 },
}

describe('validateAiEditingTimelineSource', () => {
  const audioMedia = new Map([['media-1', true]])

  it('rejects audible video without a linked audio companion', () => {
    expect(() => validateAiEditingTimelineSource(projectWith([video]), audioMedia))
      .toThrow(/缺少配对音频片段/)
  })

  it('rejects unsupported and off-canvas text transforms', () => {
    expect(() => validateAiEditingTimelineSource(
      projectWith([video, audio, { ...text, transform: { x: 0, y: 0, scale: 1 } }]),
      audioMedia,
    )).toThrow(/不支持的 transform 字段“scale”/)

    expect(() => validateAiEditingTimelineSource(
      projectWith([video, audio, { ...text, transform: { x: 960, y: 540 } }]),
      audioMedia,
    )).toThrow(/中心位于画布外/)
  })

  it('rejects subtitles below an overlapping video layer', () => {
    expect(() => validateAiEditingTimelineSource(
      projectWith([video, audio, text], { subtitleOrder: 2 }),
      audioMedia,
    )).toThrow(/位于视频轨道下方/)
  })

  it('accepts linked source audio and center-relative subtitles above video', () => {
    expect(() => validateAiEditingTimelineSource(
      projectWith([video, audio, text]),
      audioMedia,
    )).not.toThrow()
  })
})
