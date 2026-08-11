// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { EditingSourceRepositoryError, EmbeddedEditingSourceRepository } from './git-repository'
import { VirtualEditingWorkspace } from './virtual-files'

function createWorkspace(): VirtualEditingWorkspace {
  return new VirtualEditingWorkspace({
    sourceRevision: 12,
    files: [
      { path: 'manifest.json', content: '{"main":"sequences/main.sequence.json"}' },
      { path: 'sequences/main.sequence.json', content: '{"segments":["opening"]}' },
      { path: 'segments/opening.segment.json', content: '{"label":"Opening"}' },
    ],
  })
}

function expectRepositoryError(action: () => unknown, code: string): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(EditingSourceRepositoryError)
    expect((error as EditingSourceRepositoryError).code).toBe(code)
    return
  }
  throw new Error(`Expected ${code}`)
}

describe('EmbeddedEditingSourceRepository', () => {
  it('reports worktree status and full source diffs without changing the timeline revision', async () => {
    const workspace = createWorkspace()
    const repository = await EmbeddedEditingSourceRepository.create({ workspace, now: () => 1 })

    expect(repository.status()).toMatchObject({
      branch: 'main',
      sourceRevision: 12,
      dirty: false,
      changes: [],
    })
    workspace.applyPatch({
      operations: [
        {
          op: 'replace',
          path: 'segments/opening.segment.json',
          oldText: 'Opening',
          newText: 'Cold open',
        },
        { op: 'write', path: 'segments/end.segment.json', content: '{"label":"End"}' },
      ],
    })

    expect(repository.status()).toMatchObject({
      sourceRevision: 12,
      dirty: true,
      changes: [
        { path: 'segments/end.segment.json', status: 'created' },
        { path: 'segments/opening.segment.json', status: 'modified' },
      ],
    })
    expect(repository.diff().changes).toEqual([
      {
        path: 'segments/end.segment.json',
        status: 'created',
        after: '{"label":"End"}',
      },
      {
        path: 'segments/opening.segment.json',
        status: 'modified',
        before: '{"label":"Opening"}',
        after: '{"label":"Cold open"}',
      },
    ])
    expect(workspace.sourceRevision).toBe(12)
  })

  it('stores complete history and makes identical commits idempotent', async () => {
    const workspace = createWorkspace()
    const repository = await EmbeddedEditingSourceRepository.create({ workspace, now: () => 1 })
    const initialId = repository.status().headCommitId
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'components/title.component.json', content: '{}' }],
    })

    const first = await repository.commit({ message: 'Add title', now: () => 2 })
    const repeated = await repository.commit({ message: 'Different message', now: () => 3 })

    expect(first.created).toBe(true)
    expect(repeated).toEqual({ commit: first.commit, created: false })
    expect(first.commit).toMatchObject({
      parentId: initialId,
      branch: 'main',
      message: 'Add title',
      sourceRevision: 12,
    })
    expect(first.commit.files).toContainEqual({
      path: 'components/title.component.json',
      content: '{}',
    })
    expect(repository.log().map((commit) => commit.id)).toEqual([first.commit.id, initialId])
    expect(repository.status().dirty).toBe(false)
    expect(workspace.status().dirty).toBe(true)

    repository.resetToCommit(initialId)
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'components/title.component.json', content: '{}' }],
    })
    const rebuilt = await repository.commit({ message: 'Rebuild the same tree', now: () => 4 })
    expect(rebuilt).toEqual({ commit: first.commit, created: false })
  })

  it('keeps independent branch heads and restores their complete snapshots', async () => {
    const workspace = createWorkspace()
    const repository = await EmbeddedEditingSourceRepository.create({ workspace })
    const mainId = repository.status().headCommitId
    repository.branch('feature/captions')
    repository.checkout('feature/captions')
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'components/caption.component.json', content: '{}' }],
    })
    const feature = await repository.commit({ message: 'Add captions' })

    repository.checkout('main')

    expect(repository.status()).toMatchObject({
      branch: 'main',
      headCommitId: mainId,
      dirty: false,
    })
    expect(() => workspace.read('components/caption.component.json')).toThrow()
    expect(repository.branchesList()).toEqual([
      { name: 'feature/captions', commitId: feature.commit.id, current: false },
      { name: 'main', commitId: mainId, current: true },
    ])
    expect(repository.log({ branch: 'feature/captions' })[0]?.id).toBe(feature.commit.id)
  })

  it('protects dirty work before checkout unless force is explicit', async () => {
    const workspace = createWorkspace()
    const repository = await EmbeddedEditingSourceRepository.create({ workspace })
    repository.branch('alternate')
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'segments/draft.segment.json', content: '{}' }],
    })

    expectRepositoryError(() => repository.checkout('alternate'), 'DIRTY_WORKTREE')
    expect(workspace.read('segments/draft.segment.json').content).toBe('{}')

    repository.checkout('alternate', { force: true })
    expect(repository.status()).toMatchObject({ branch: 'alternate', dirty: false })
    expect(() => workspace.read('segments/draft.segment.json')).toThrow()
  })

  it('resets a branch to an earlier commit and protects dirty work', async () => {
    const workspace = createWorkspace()
    const repository = await EmbeddedEditingSourceRepository.create({ workspace })
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'segments/a.segment.json', content: '{"v":1}' }],
    })
    const first = await repository.commit({ message: 'First version' })
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'segments/a.segment.json', content: '{"v":2}' }],
    })
    await repository.commit({ message: 'Second version' })
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'segments/scratch.segment.json', content: '{}' }],
    })

    expectRepositoryError(() => repository.resetToCommit(first.commit.id), 'DIRTY_WORKTREE')
    repository.resetToCommit(first.commit.id, { force: true })

    expect(repository.status()).toMatchObject({ headCommitId: first.commit.id, dirty: false })
    expect(workspace.read('segments/a.segment.json').content).toBe('{"v":1}')
    expect(() => workspace.read('segments/scratch.segment.json')).toThrow()
    expect(repository.log()[0]?.id).toBe(first.commit.id)
  })

  it('derives stable initial commit ids from source content rather than timestamps', async () => {
    const first = await EmbeddedEditingSourceRepository.create({
      workspace: createWorkspace(),
      now: () => 1,
    })
    const second = await EmbeddedEditingSourceRepository.create({
      workspace: createWorkspace(),
      now: () => 999,
    })

    expect(first.status().headCommitId).toBe(second.status().headCommitId)
  })
})
