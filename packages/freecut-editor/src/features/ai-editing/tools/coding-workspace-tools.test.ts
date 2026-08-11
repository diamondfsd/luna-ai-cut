import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const harness = vi.hoisted(() => ({
  publish: vi.fn(async (commitId: string) => ({ ok: true, commitId, revisionAfter: 2 })),
}))

vi.mock('../coding-workspace/session-registry', () => ({
  getTimelineCodingSession: () => ({ publish: harness.publish }),
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
