import { describe, expect, it, vi } from 'vite-plus/test'
import type { EditProgram, EditProgramApplyResult } from '../edit-program/types'
import type { DurableEditingSourceRepository } from './durable-source-repository'
import type { TimelineBuildPublication, TimelineBuildStateStore } from './build-state'
import {
  summarizeTimelineProgram,
  TimelineCodingSession,
  type TimelineCheckout,
  type TimelineProgramDiff,
} from './timeline-session'
import { VirtualEditingWorkspace } from './virtual-files'

class MemoryBuildStateStore implements TimelineBuildStateStore {
  publication: TimelineBuildPublication | null = null
  failNextSave = false

  async load() {
    return this.publication ? structuredClone(this.publication) : null
  }

  async save(_projectId: string, publication: TimelineBuildPublication) {
    if (this.failNextSave) {
      this.failNextSave = false
      throw new Error('disk full')
    }
    this.publication = structuredClone(publication)
  }
}

function createWorkspace() {
  return new VirtualEditingWorkspace({
    sourceRevision: 1,
    files: [{ path: 'manifest.json', content: '{}' }],
  })
}

function createRepository(workspace: VirtualEditingWorkspace) {
  return {
    projectId: 'project-1',
    workspace,
    runAtCleanHead: async <T>(_commitId: string, operation: () => Promise<T>) => operation(),
  } as DurableEditingSourceRepository
}

function createProgram(baseRevision: number, intent = 'Build title'): EditProgram {
  return {
    version: 1,
    baseRevision,
    sourceProjectId: 'project-1',
    intent,
    operations: [
      { type: 'insertText', text: { ref: 'title', text: 'Title', start: 0, duration: 2 } },
    ],
  }
}

function createDiff(): TimelineProgramDiff {
  return {
    operationCount: 1,
    operationTypes: { insertText: 1 },
    changedRanges: [{ start: 0, end: 2 }],
    created: ['clip:title'],
    updated: [],
    removed: [],
    transitionsChanged: 0,
  }
}

function createReceipt(revisionBefore: number, revisionAfter: number): EditProgramApplyResult {
  return {
    committed: true,
    revisionBefore,
    revisionAfter,
    diff: {
      created: ['clip:title'],
      updated: [],
      removed: [],
      changedRanges: [{ start: 0, end: 2 }],
      transitionsChanged: 0,
    },
    warnings: [],
  }
}

function createCheckout(input: { program: EditProgram; receipt: EditProgramApplyResult }) {
  const diff = createDiff()
  const commit = vi.fn(async ({ commitId }: { commitId: string }) => ({
    ok: true as const,
    commitId,
    revisionBefore: input.receipt.revisionBefore,
    revisionAfter: input.receipt.revisionAfter,
    artifact: input.program,
    diff,
    receipt: input.receipt,
    diagnostics: [],
  }))
  return {
    checkout: {
      captured: { revision: input.program.baseRevision, source: {} },
      diff: vi.fn(async () => ({
        artifact: input.program,
        diff,
        diagnostics: [],
      })),
      commit,
    } as unknown as TimelineCheckout,
    commit,
  }
}

describe('summarizeTimelineProgram', () => {
  it('summarizes a multi-shot program without imposing a shot count limit', () => {
    const program: EditProgram = {
      version: 1,
      baseRevision: 3,
      intent: 'Build a modular short video',
      operations: [
        {
          type: 'insertClip',
          clip: { ref: 'a', mediaRef: 'media:a', trackRef: 'track:v1', start: 0, duration: 3 },
        },
        {
          type: 'insertClip',
          clip: { ref: 'b', mediaRef: 'media:b', trackRef: 'track:v1', start: 3, duration: 4 },
        },
        { type: 'insertText', text: { ref: 'title', text: 'Title', start: 0, duration: 2 } },
      ],
    }

    expect(summarizeTimelineProgram(program)).toEqual({
      operationCount: 3,
      operationTypes: { insertClip: 2, insertText: 1 },
      changedRanges: [
        { start: 0, end: 3 },
        { start: 3, end: 7 },
        { start: 0, end: 2 },
      ],
    })
  })
})

describe('TimelineCodingSession publish replay protection', () => {
  it('returns the stored success across sessions without calling the live adapter twice', async () => {
    const buildState = new MemoryBuildStateStore()
    const firstWorkspace = createWorkspace()
    const firstCheckout = createCheckout({
      program: createProgram(4),
      receipt: createReceipt(4, 5),
    })
    const firstSession = new TimelineCodingSession(
      firstWorkspace,
      createRepository(firstWorkspace),
      firstCheckout.checkout,
      buildState,
    )

    await expect(firstSession.publish('source-commit-1')).resolves.toMatchObject({
      ok: true,
      revisionBefore: 4,
      revisionAfter: 5,
    })
    expect(firstCheckout.commit).toHaveBeenCalledTimes(1)

    const reopenedWorkspace = createWorkspace()
    const reopenedCheckout = createCheckout({
      program: createProgram(5),
      receipt: createReceipt(5, 6),
    })
    const reopenedSession = new TimelineCodingSession(
      reopenedWorkspace,
      createRepository(reopenedWorkspace),
      reopenedCheckout.checkout,
      buildState,
    )

    await expect(reopenedSession.publish('source-commit-1')).resolves.toMatchObject({
      ok: true,
      revisionBefore: 4,
      revisionAfter: 5,
    })
    expect(reopenedCheckout.commit).not.toHaveBeenCalled()
  })

  it('reconciles the same source commit after the live timeline revision drifts', async () => {
    const buildState = new MemoryBuildStateStore()
    const firstWorkspace = createWorkspace()
    const firstCheckout = createCheckout({
      program: createProgram(4),
      receipt: createReceipt(4, 5),
    })
    await new TimelineCodingSession(
      firstWorkspace,
      createRepository(firstWorkspace),
      firstCheckout.checkout,
      buildState,
    ).publish('source-commit-1')

    const changedWorkspace = createWorkspace()
    const changedCheckout = createCheckout({
      program: createProgram(6),
      receipt: createReceipt(6, 7),
    })
    const changedSession = new TimelineCodingSession(
      changedWorkspace,
      createRepository(changedWorkspace),
      changedCheckout.checkout,
      buildState,
    )

    await expect(changedSession.publish('source-commit-1')).resolves.toMatchObject({
      ok: true,
      revisionBefore: 6,
      revisionAfter: 7,
    })
    expect(changedCheckout.commit).toHaveBeenCalledTimes(1)
  })

  it('retries publication persistence without applying the live edit again', async () => {
    const buildState = new MemoryBuildStateStore()
    buildState.failNextSave = true
    const workspace = createWorkspace()
    const checkout = createCheckout({ program: createProgram(4), receipt: createReceipt(4, 5) })
    const session = new TimelineCodingSession(
      workspace,
      createRepository(workspace),
      checkout.checkout,
      buildState,
    )

    await expect(session.publish('source-commit-1')).rejects.toThrow('disk full')
    await expect(session.publish('source-commit-1')).resolves.toMatchObject({
      ok: true,
      revisionAfter: 5,
    })
    expect(checkout.commit).toHaveBeenCalledTimes(1)
    expect(buildState.publication).toMatchObject({ sourceCommitId: 'source-commit-1' })
  })

  it('publishes a new source commit even when its semantic build is unchanged', async () => {
    const buildState = new MemoryBuildStateStore()
    const firstWorkspace = createWorkspace()
    const firstCheckout = createCheckout({
      program: createProgram(4),
      receipt: createReceipt(4, 5),
    })
    const firstSession = new TimelineCodingSession(
      firstWorkspace,
      createRepository(firstWorkspace),
      firstCheckout.checkout,
      buildState,
    )
    await firstSession.publish('source-commit-1')

    const nextWorkspace = createWorkspace()
    const nextCheckout = createCheckout({ program: createProgram(5), receipt: createReceipt(5, 6) })
    const nextSession = new TimelineCodingSession(
      nextWorkspace,
      createRepository(nextWorkspace),
      nextCheckout.checkout,
      buildState,
    )

    await expect(nextSession.publish('source-commit-2')).resolves.toMatchObject({
      ok: true,
      revisionBefore: 5,
      revisionAfter: 6,
    })
    expect(nextCheckout.commit).toHaveBeenCalledTimes(1)
  })

  it('rejects a changed build under an already-published source commit', async () => {
    const buildState = new MemoryBuildStateStore()
    const firstWorkspace = createWorkspace()
    const firstCheckout = createCheckout({
      program: createProgram(4),
      receipt: createReceipt(4, 5),
    })
    await new TimelineCodingSession(
      firstWorkspace,
      createRepository(firstWorkspace),
      firstCheckout.checkout,
      buildState,
    ).publish('source-commit-1')

    const changedWorkspace = createWorkspace()
    const changedCheckout = createCheckout({
      program: createProgram(5, 'Changed build'),
      receipt: createReceipt(5, 6),
    })
    const changedSession = new TimelineCodingSession(
      changedWorkspace,
      createRepository(changedWorkspace),
      changedCheckout.checkout,
      buildState,
    )

    await expect(changedSession.publish('source-commit-1')).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'PUBLISHED_BUILD_MISMATCH' }],
    })
    expect(changedCheckout.commit).not.toHaveBeenCalled()
  })
})
