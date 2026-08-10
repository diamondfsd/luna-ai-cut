// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@freecut/types/project'
import { migrateProject } from './index'

describe('text track normalization', () => {
  it('keeps plain title text on its dedicated text track', () => {
    const project = {
      id: 'project-1',
      name: 'Project',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 300,
      schemaVersion: 15,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [{
          id: 'text-track',
          name: 'S1',
          kind: 'subtitle',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: -1,
        }],
        items: [{
          id: 'title-1',
          type: 'text',
          trackId: 'text-track',
          from: 0,
          durationInFrames: 90,
          label: 'Title',
          text: 'Title',
          color: '#fff',
        }],
        transitions: [],
        currentFrame: 0,
        zoomLevel: 1,
        scrollPosition: 0,
      },
    } as Project

    const timeline = migrateProject(project).project.timeline!

    expect(timeline.tracks).toEqual([
      expect.objectContaining({ id: 'text-track', name: 'S1', kind: 'subtitle' }),
    ])
    expect(timeline.items[0]).toMatchObject({ id: 'title-1', trackId: 'text-track' })
  })
})
