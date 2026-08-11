import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const harness = vi.hoisted(() => ({
  publish: vi.fn(async (commitId: string) => ({
    ok: true,
    commitId,
    revisionBefore: 1,
    revisionAfter: 2,
    diff: {
      operationCount: 0,
      operationTypes: {},
      changedRanges: [],
      created: [],
      updated: [],
      removed: [],
      transitionsChanged: 0,
    },
    diagnostics: [],
  })),
  build: vi.fn(async () => ({
    artifact: {
      version: 1,
      baseRevision: 3,
      sourceProjectId: 'project-1',
      intent: 'Build a short video',
      operations: [{
        type: 'insertText',
        text: { ref: 'title', text: 'Title', start: 0, duration: 2 },
      }],
    },
    diagnostics: [],
  })),
}))

vi.mock('../coding-workspace/session-registry', () => ({
  getTimelineCodingSession: () => ({ publish: harness.publish, build: harness.build }),
}))

import { aiEditingToolModule } from './coding-workspace-tools'

function tools() {
  return aiEditingToolModule.createTools({ listTools: () => [] })
}

describe('coding workspace tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports the generic workspace, Git, and timeline command surface', () => {
    expect(tools().map((tool) => tool.id)).toEqual([
      'workspace.list',
      'workspace.read',
      'workspace.search',
      'workspace.patch',
      'workspace.status',
      'git.status',
      'git.diff',
      'git.log',
      'git.branch',
      'git.commit',
      'timeline.check',
      'timeline.build',
      'timeline.test',
      'timeline.diff',
      'timeline.publish_stage',
      'timeline.commit',
    ])
  })

  it('marks state-changing commands as edits', () => {
    const byId = new Map(tools().map((tool) => [tool.id, tool]))

    expect(byId.get('workspace.patch')?.risk).toBe('edit')
    expect(byId.get('git.commit')?.risk).toBe('edit')
    expect(byId.get('timeline.publish_stage')?.risk).toBe('edit')
    expect(byId.get('timeline.commit')?.risk).toBe('edit')
    expect(byId.get('timeline.build')?.risk).toBe('read')
    expect(byId.get('timeline.test')?.risk).toBe('read')
  })

  it('publishes stage and final commits through the active coding session', async () => {
    const byId = new Map(tools().map((tool) => [tool.id, tool]))

    await byId.get('timeline.publish_stage')!.execute({ commitId: 'stage-commit' }, {} as never)
    await byId.get('timeline.commit')!.execute({ commitId: 'stage-commit' }, {} as never)

    expect(harness.publish).toHaveBeenNthCalledWith(1, 'stage-commit')
    expect(harness.publish).toHaveBeenNthCalledWith(2, 'stage-commit')
  })

  it('returns a bounded build summary instead of the complete artifact', async () => {
    const build = tools().find((tool) => tool.id === 'timeline.build')!

    const result = await build.execute({}, {} as never)

    expect(result).toMatchObject({
      ok: true,
      data: {
        diagnostics: [],
        build: {
          baseRevision: 3,
          operationCount: 1,
          operationTypes: { insertText: 1 },
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain('"operations"')
  })

  it('rejects patches to read-only projection files and unknown fields', () => {
    const patch = tools().find((tool) => tool.id === 'workspace.patch')!

    expect(
      patch.validate({
        operations: [{ op: 'write', path: 'media/index.json', content: '{}' }],
      }),
    ).toMatchObject({ ok: false })
    expect(
      patch.validate({
        operations: [{ op: 'write', path: 'segments/opening.segment.json', content: '{}' }],
        unexpected: true,
      }),
    ).toMatchObject({ ok: false })
    expect(
      patch.validate({
        expectedRevision: 0,
        operations: [{ op: 'write', path: 'segments/opening.segment.json', content: '{}' }],
      }),
    ).toMatchObject({ ok: true })
  })
})
