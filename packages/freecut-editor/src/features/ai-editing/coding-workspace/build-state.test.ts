import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { EditProgram } from '../edit-program/types'

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  buildTimelineFromStores: vi.fn(() => ({ tracks: [], items: [] })),
}))

vi.mock('@freecut/infrastructure/storage', () => ({
  getProject: mocks.getProject,
  updateProject: mocks.updateProject,
}))

vi.mock('@freecut/features/timeline/stores/timeline-persistence', () => ({
  buildTimelineFromStores: mocks.buildTimelineFromStores,
}))

import {
  fingerprintTimelineBuild,
  ProjectTimelineBuildStateStore,
  type TimelineBuildPublication,
} from './build-state'

const publication: TimelineBuildPublication = {
  version: 1,
  sourceCommitId: 'source-commit-1',
  buildFingerprint: 'sha256:abc',
  revisionBefore: 4,
  revisionAfter: 5,
  receipt: {
    committed: true,
    revisionBefore: 4,
    revisionAfter: 5,
    diff: {
      created: ['clip:title'],
      updated: [],
      removed: [],
      changedRanges: [{ start: 0, end: 2 }],
      transitionsChanged: 0,
    },
    warnings: [],
  },
  publishedAt: 123,
}

function program(baseRevision: number, mode?: 'preview' | 'commit'): EditProgram {
  return {
    version: 1,
    baseRevision,
    sourceProjectId: 'project-1',
    intent: 'Build title',
    ...(mode ? { mode } : {}),
    operations: [
      { type: 'insertText', text: { ref: 'title', text: 'Title', start: 0, duration: 2 } },
    ],
  }
}

describe('ProjectTimelineBuildStateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateProject.mockResolvedValue(undefined)
  })

  it('loads the durable publication from the project record', async () => {
    mocks.getProject.mockResolvedValue({ id: 'project-1', aiEditingPublication: publication })

    await expect(new ProjectTimelineBuildStateStore().load('project-1')).resolves.toEqual(
      publication,
    )
  })

  it('persists the timeline and publication in one project update', async () => {
    await new ProjectTimelineBuildStateStore().save('project-1', publication)

    expect(mocks.updateProject).toHaveBeenCalledTimes(1)
    expect(mocks.updateProject).toHaveBeenCalledWith('project-1', {
      timeline: { tracks: [], items: [] },
      aiEditingPublication: publication,
    })
  })
})

describe('fingerprintTimelineBuild', () => {
  it('ignores checkout revision and preview mode for cross-session replay detection', async () => {
    await expect(fingerprintTimelineBuild(program(4, 'commit'))).resolves.toBe(
      await fingerprintTimelineBuild(program(99, 'preview')),
    )
  })
})
