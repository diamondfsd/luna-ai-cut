import type { EmbeddedAiEditingSourceGitBridge } from '@freecut/shared/host/embedded-host'
import { describe, expect, it, vi } from 'vite-plus/test'
import { DurableEditingSourceRepository } from './durable-source-repository'
import { TimelineCodingSession, type TimelineCheckout } from './timeline-session'
import type { VirtualFileInput } from './virtual-files'

type SourceChange = { path: string; content: string | null }

class FakeSourceGitBridge implements EmbeddedAiEditingSourceGitBridge {
  readonly ensureCalls: Array<Record<string, string>> = []
  readonly changeBatches: SourceChange[][] = []
  readonly files = new Map<string, string>()
  private headFiles = new Map<string, string>()
  private commits: Array<{ oid: string; message: string }> = []
  private initialized = false
  failNextChanges = false

  async ensure(_projectId: string, initialFiles: Record<string, string> = {}) {
    this.ensureCalls.push(structuredClone(initialFiles))
    if (!this.initialized) {
      this.initialized = true
      this.files.clear()
      Object.entries(initialFiles).forEach(([path, content]) => this.files.set(path, content))
      this.headFiles = new Map(this.files)
      this.commits = [{ oid: 'commit-1', message: 'Initialize editing source' }]
      return { created: true, head: 'commit-1' }
    }
    return { created: false, head: this.commits[0]?.oid ?? null }
  }

  async status() {
    const entries = [...new Set([...this.headFiles.keys(), ...this.files.keys()])]
      .sort()
      .flatMap((path) => {
        const before = this.headFiles.get(path)
        const after = this.files.get(path)
        if (before === after) return []
        const change = before === undefined ? 'added' : after === undefined ? 'deleted' : 'modified'
        return [{ path, change } as const]
      })
    return { branch: 'main', clean: entries.length === 0, entries }
  }

  async list(_projectId: string, sourceDirectory = '') {
    const prefix = sourceDirectory ? `${sourceDirectory}/` : ''
    const entries = new Map<string, { path: string; name: string; type: 'file' | 'directory' }>()
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const relative = path.slice(prefix.length)
      if (!relative) continue
      const [name, ...rest] = relative.split('/')
      if (!name) continue
      const entryPath = prefix ? `${sourceDirectory}/${name}` : name
      entries.set(entryPath, {
        path: entryPath,
        name,
        type: rest.length > 0 ? 'directory' : 'file',
      })
    }
    return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
  }

  async read(_projectId: string, sourcePath: string) {
    const content = this.files.get(sourcePath)
    if (content === undefined) throw new Error(`missing ${sourcePath}`)
    return content
  }

  async write(projectId: string, sourcePath: string, content: string) {
    await this.applyChanges(projectId, [{ path: sourcePath, content }])
  }

  async remove(projectId: string, sourcePath: string) {
    await this.applyChanges(projectId, [{ path: sourcePath, content: null }])
  }

  async applyChanges(_projectId: string, changes: SourceChange[]) {
    this.changeBatches.push(structuredClone(changes))
    if (this.failNextChanges) {
      this.failNextChanges = false
      throw new Error('host write failed')
    }
    changes.forEach(({ path, content }) => {
      if (content === null) this.files.delete(path)
      else this.files.set(path, content)
    })
  }

  async diff() {
    const status = await this.status()
    return status.entries.map(({ path, change }) => ({
      path,
      change,
      before: this.headFiles.get(path) ?? null,
      after: this.files.get(path) ?? null,
    }))
  }

  async log(_projectId: string, limit = 50) {
    return this.commits.slice(0, limit).map(({ oid, message }) => ({
      oid,
      message,
      author: { name: 'Luna Editing Agent', email: 'editing-agent@luna.local', timestamp: 1 },
    }))
  }

  async branches() {
    return { current: 'main', names: ['main'] }
  }

  async createBranch() {}

  async checkout() {}

  async commit(_projectId: string, message: string) {
    const oid = `commit-${this.commits.length + 1}`
    this.headFiles = new Map(this.files)
    this.commits.unshift({ oid, message })
    return oid
  }
}

const initialProjection = (evidence: string): VirtualFileInput[] => [
  { path: 'manifest.json', content: '{"main":"sequences/main.sequence.json"}' },
  { path: 'sequences/main.sequence.json', content: '{"imports":[]}' },
  { path: 'segments/main.segment.json', content: '{"operations":[]}' },
  { path: 'media/index.json', content: evidence },
  { path: 'evidence/timeline/sequence.json', content: evidence },
]

async function openRepository(bridge: FakeSourceGitBridge, evidence = 'projection-v1') {
  return DurableEditingSourceRepository.open({
    projectId: 'project-1',
    sourceRevision: 4,
    projectedFiles: initialProjection(evidence),
    bridge,
  })
}

describe('DurableEditingSourceRepository', () => {
  it('initializes Git with source only and persists each patch as one batch', async () => {
    const bridge = new FakeSourceGitBridge()
    const repository = await openRepository(bridge)

    expect(Object.keys(bridge.ensureCalls[0] ?? {}).sort()).toEqual([
      'manifest.json',
      'segments/main.segment.json',
      'sequences/main.sequence.json',
    ])

    await repository.applyPatch({
      expectedRevision: 0,
      operations: [
        { op: 'write', path: 'segments/main.segment.json', content: '{"operations":[1]}' },
        { op: 'write', path: 'components/title.json', content: '{"text":"Title"}' },
      ],
    })

    expect(bridge.changeBatches).toEqual([
      [
        { path: 'segments/main.segment.json', content: '{"operations":[1]}' },
        { path: 'components/title.json', content: '{"text":"Title"}' },
      ],
    ])
    expect(repository.workspace.status()).toMatchObject({ revision: 1, dirty: true })

    await expect(repository.commit('Build title')).resolves.toEqual({
      commitId: 'commit-2',
      created: true,
    })
    await expect(repository.status()).resolves.toMatchObject({
      headCommitId: 'commit-2',
      clean: true,
    })
    expect(repository.workspace.status()).toMatchObject({ revision: 1, dirty: false })
  })

  it('reopens from the Git worktree while refreshing read-only projection files', async () => {
    const bridge = new FakeSourceGitBridge()
    const first = await openRepository(bridge)
    await first.applyPatch({
      operations: [
        { op: 'write', path: 'segments/main.segment.json', content: '{"persisted":true}' },
      ],
    })
    await first.commit('Persist source')

    const reopened = await openRepository(bridge, 'projection-v2')

    expect(reopened.workspace.read('segments/main.segment.json').content).toBe('{"persisted":true}')
    expect(reopened.workspace.read('media/index.json').content).toBe('projection-v2')
    expect(reopened.workspace.read('evidence/timeline/sequence.json').content).toBe('projection-v2')
    expect(bridge.files.has('media/index.json')).toBe(false)
    expect(bridge.ensureCalls).toHaveLength(2)
  })

  it('restores content, dirty state, and revision when host persistence fails', async () => {
    const bridge = new FakeSourceGitBridge()
    const repository = await openRepository(bridge)
    const before = repository.workspace.status()
    bridge.failNextChanges = true

    await expect(
      repository.applyPatch({
        expectedRevision: 0,
        operations: [
          { op: 'write', path: 'segments/main.segment.json', content: '{"broken":true}' },
          { op: 'write', path: 'components/temporary.json', content: '{}' },
        ],
      }),
    ).rejects.toThrow('host write failed')

    expect(repository.workspace.read('segments/main.segment.json').content).toBe(
      '{"operations":[]}',
    )
    expect(() => repository.workspace.read('components/temporary.json')).toThrow()
    expect(repository.workspace.status()).toEqual(before)
    await expect(repository.status()).resolves.toMatchObject({ clean: true })
  })

  it('publishes only a clean worktree at the requested HEAD commit', async () => {
    const bridge = new FakeSourceGitBridge()
    const repository = await openRepository(bridge)
    let releasePublish: () => void = () => undefined
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    const artifact = { version: 1 as const, baseRevision: 4, intent: 'test', operations: [] }
    const diff = {
      operationCount: 0,
      operationTypes: {},
      changedRanges: [],
      created: [],
      updated: [],
      removed: [],
      transitionsChanged: 0,
    }
    const commit = vi.fn(async ({ commitId }: { commitId: string }) => {
      await publishGate
      return {
        ok: true as const,
        commitId,
        revisionBefore: 4,
        revisionAfter: 5,
        artifact,
        diff,
        receipt: {
          committed: true,
          revisionBefore: 4,
          revisionAfter: 5,
          diff: {
            created: [],
            updated: [],
            removed: [],
            changedRanges: [],
            transitionsChanged: 0,
          },
          warnings: [],
        },
        diagnostics: [],
      }
    })
    const checkout = {
      captured: { revision: 4, source: {} },
      diff: vi.fn(async () => ({ artifact, diff, diagnostics: [] })),
      commit,
    } as unknown as TimelineCheckout
    const buildState = { load: vi.fn(async () => null), save: vi.fn(async () => undefined) }
    const session = new TimelineCodingSession(
      repository.workspace,
      repository,
      checkout,
      buildState,
    )

    await expect(session.publish('missing')).rejects.toThrow('请先提交')
    await repository.applyPatch({
      operations: [{ op: 'write', path: 'segments/main.segment.json', content: '{"dirty":true}' }],
    })
    await expect(session.publish('commit-1')).rejects.toThrow('请先提交')

    const { commitId } = await repository.commit('Ready to publish')
    await expect(session.publish('commit-1')).rejects.toThrow('请先提交')
    const publishing = session.publish(commitId)
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    const queuedPatch = repository.applyPatch({
      operations: [
        { op: 'write', path: 'segments/main.segment.json', content: '{"afterPublish":true}' },
      ],
    })
    await Promise.resolve()
    expect(repository.workspace.read('segments/main.segment.json').content).toBe('{"dirty":true}')
    releasePublish()

    await expect(publishing).resolves.toMatchObject({ ok: true, commitId })
    await queuedPatch
    expect(repository.workspace.read('segments/main.segment.json').content).toBe(
      '{"afterPublish":true}',
    )
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ commitId, workspace: repository.workspace })
  })
})
