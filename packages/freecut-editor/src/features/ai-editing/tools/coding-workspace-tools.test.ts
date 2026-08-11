import { describe, expect, it } from 'vite-plus/test'
import { aiEditingToolModule } from './coding-workspace-tools'

function tools() {
  return aiEditingToolModule.createTools({ listTools: () => [] })
}

describe('coding workspace tools', () => {
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
      'timeline.commit',
    ])
  })

  it('marks state-changing commands as edits', () => {
    const byId = new Map(tools().map((tool) => [tool.id, tool]))

    expect(byId.get('workspace.patch')?.risk).toBe('edit')
    expect(byId.get('git.commit')?.risk).toBe('edit')
    expect(byId.get('timeline.commit')?.risk).toBe('edit')
    expect(byId.get('timeline.build')?.risk).toBe('read')
    expect(byId.get('timeline.test')?.risk).toBe('read')
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
