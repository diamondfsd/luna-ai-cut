// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { AgentClip, AgentWorkspaceDocument } from '../edit-program/types'
import { MAX_CLIPS_PER_SEGMENT, projectAgentWorkspaceToFiles } from './project-projection'

function clip(index: number): AgentClip {
  return {
    ref: `clip:${index}`,
    label: `Clip ${index}`,
    type: 'video',
    trackRef: 'track:v1',
    start: index,
    duration: 1,
    mediaRef: 'media:m1',
  }
}

function workspace(clips: AgentClip[]): AgentWorkspaceDocument {
  return {
    schemaVersion: 1,
    revision: 7,
    project: { id: 'p1', title: 'Large edit', width: 1920, height: 1080, fps: 30, duration: 200 },
    viewport: { playhead: 0, selectedClipRefs: [] },
    media: [
      {
        ref: 'media:m1',
        name: 'source.mp4',
        kind: 'video',
        duration: 200,
        hasAudio: true,
        evidence: {
          visual: [{ time: 1, description: 'opening', subjects: ['screen'] }],
          transcript: {
            segmentCount: 1,
            wordCount: 2,
            excerpt: [{ start: 0, end: 1, text: 'hello' }],
          },
          audioAnalysis: 'ready',
        },
      },
    ],
    tracks: [{ ref: 'track:v1', name: 'V1', kind: 'video', order: 0, locked: false }],
    clips,
    transitions: [],
  }
}

describe('projectAgentWorkspaceToFiles', () => {
  it('projects media and evidence into independently searchable files', () => {
    const files = projectAgentWorkspaceToFiles(workspace([clip(0)]))
    const paths = files.map((file) => file.path)

    expect(paths).toContain('manifest.json')
    expect(paths).toContain('media/m1.json')
    expect(paths).toContain('evidence/visual/m1.json')
    expect(paths).toContain('evidence/transcripts/m1.json')
    expect(
      files.find((file) => file.path === 'evidence/timeline/sequence.json')?.content,
    ).toContain('"baselineRevision": 7')
  })

  it('bounds large timeline snapshot files by clip count', () => {
    const clips = Array.from({ length: MAX_CLIPS_PER_SEGMENT * 2 + 1 }, (_, index) => clip(index))
    const files = projectAgentWorkspaceToFiles(workspace(clips))
    const segments = files.filter((file) => file.path.startsWith('evidence/timeline/current-'))

    expect(segments).toHaveLength(3)
    expect(JSON.parse(segments[0]!.content).clips).toHaveLength(MAX_CLIPS_PER_SEGMENT)
    expect(JSON.parse(segments[2]!.content).clips).toHaveLength(1)
  })

  it('keeps sanitized media file paths unique', () => {
    const source = workspace([])
    source.media = [
      { ...source.media[0]!, ref: 'media:a/b', name: 'slash.mp4' },
      { ...source.media[0]!, ref: 'media:a?b', name: 'question.mp4' },
    ]

    const files = projectAgentWorkspaceToFiles(source)
    const index = JSON.parse(files.find((file) => file.path === 'media/index.json')!.content)

    expect(index.items.map((item: { detail: string }) => item.detail)).toEqual([
      'media/a-b.json',
      'media/a-b-2.json',
    ])
    expect(files.map((file) => file.path)).toContain('evidence/visual/a-b-2.json')
  })

  it('keeps cross-segment transitions discoverable in both timeline chunks', () => {
    const source = workspace(
      Array.from({ length: MAX_CLIPS_PER_SEGMENT + 1 }, (_, index) => clip(index)),
    )
    source.transitions = [
      {
        ref: 'transition:cross-chunk',
        between: [`clip:${MAX_CLIPS_PER_SEGMENT - 1}`, `clip:${MAX_CLIPS_PER_SEGMENT}`],
        presentation: 'fade',
        duration: 0.5,
      },
    ]

    const files = projectAgentWorkspaceToFiles(source)
    const segments = files.filter((file) => file.path.startsWith('evidence/timeline/current-'))

    expect(JSON.parse(segments[0]!.content).transitions).toHaveLength(1)
    expect(JSON.parse(segments[1]!.content).transitions).toHaveLength(1)
  })
})
