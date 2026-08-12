// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@freecut/types/project'
import type { MediaMetadata } from '@freecut/types/storage'
import { composeSourceProject } from './source-composition-tools'

vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'fixed-id') })

function project(): Project {
  return {
    id: 'project-1', name: 'Test', description: '', createdAt: 1, updatedAt: 1,
    duration: 0, metadata: { width: 1080, height: 1920, fps: 30 },
    timeline: {
      tracks: [
        { id: 'id-subtitle', name: '字幕', kind: 'subtitle', height: 60, locked: false, visible: true, muted: false, solo: false, order: 0 },
        { id: 'id-video', name: '视频', kind: 'video', height: 80, locked: false, visible: true, muted: false, solo: false, order: 1 },
        { id: 'id-audio', name: '音频', kind: 'audio', height: 60, locked: false, visible: true, muted: false, solo: false, order: 2 },
      ],
      items: [], transitions: [], keyframes: [],
    },
  }
}

function media(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1', storageType: 'workspace', fileName: 'clip.mp4', fileSize: 100,
    mimeType: 'video/mp4', duration: 20, width: 1920, height: 1080, fps: 60,
    codec: 'h264', bitrate: 1_000, audioCodec: 'aac',
    ...overrides,
  }
}

describe('source composition compiler', () => {
  it('converts source seconds and creates linked video, audio, and caption items', () => {
    const result = composeSourceProject(project(), {
      clips: [{
        mediaId: 'media-1', sourceStartSeconds: 2, sourceEndSeconds: 7,
        caption: {
          text: '重点内容',
          spans: [{ text: '重点', color: '#ffcc00', fontWeight: 'bold' }, { text: '内容' }],
          style: { backgroundColor: '#000000aa', backgroundRadius: 12, textPadding: 8 },
          box: { left: 0.1, top: 0.8, width: 0.8, height: 0.1 },
        },
      }],
      includeOriginalAudio: true,
      replaceExisting: true,
    }, { 'media-1': media() })

    expect(result.duration).toBe(5)
    expect(result.timeline?.items).toHaveLength(3)
    expect(result.timeline?.items[0]).toMatchObject({
      type: 'video', trackId: 'id-video', from: 0, durationInFrames: 150,
      sourceStart: 120, sourceEnd: 420, sourceDuration: 1200, sourceFps: 60,
      linkedGroupId: 'linked-fixed-id', embeddedAudioMuted: true,
    })
    expect(result.timeline?.items[1]).toMatchObject({
      type: 'audio', trackId: 'id-audio', linkedGroupId: 'linked-fixed-id', volume: 0,
    })
    expect(result.timeline?.items[2]).toMatchObject({
      type: 'text', trackId: 'id-subtitle', text: '重点内容', spanLayout: 'inline',
      backgroundColor: '#000000aa', backgroundRadius: 12, textPadding: 8,
      transform: { x: 0, y: 672, width: 864, height: 192 },
    })
  })

  it('does not create audio for media without an audio stream', () => {
    const result = composeSourceProject(project(), {
      clips: [{ mediaId: 'media-1', sourceStartSeconds: 0, sourceEndSeconds: 3 }],
      includeOriginalAudio: true,
      replaceExisting: true,
    }, { 'media-1': media({ audioCodec: undefined }) })

    expect(result.timeline?.items).toHaveLength(1)
    expect(result.timeline?.items[0]).toMatchObject({ type: 'video' })
    expect(result.timeline?.items[0]).not.toHaveProperty('embeddedAudioMuted', true)
  })
})
