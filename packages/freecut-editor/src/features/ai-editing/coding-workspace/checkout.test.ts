import { describe, expect, it, vi } from 'vite-plus/test'
import {
  createCodingWorkspaceCheckout,
  type CodingWorkspaceAdapter,
  type CodingWorkspaceAdapterCommitResult,
} from './checkout'

interface Source {
  clips: string[]
}

interface Workspace {
  files: Record<string, string>
}

interface Artifact {
  clips: string[]
}

interface Diff {
  added: string[]
}

interface Receipt {
  saved: number
}

function fakeAdapter(input?: { invalid?: boolean; buildDelay?: Promise<void> }) {
  let revision = 4
  let source: Source = { clips: ['opening'] }
  const commitResults = new Map<string, CodingWorkspaceAdapterCommitResult<number, Receipt>>()
  const capture = vi.fn(async () => ({ revision, source: structuredClone(source) }))
  const check = vi.fn(async () => ({
    diagnostics: input?.invalid
      ? [
          {
            code: 'INVALID_SEGMENT',
            message: '片段无效。',
            severity: 'error' as const,
            stage: 'check' as const,
            retryable: false,
            path: 'segments/opening.json',
          },
        ]
      : [],
  }))
  const build = vi.fn(async ({ workspace }: { workspace: Workspace }) => {
    await input?.buildDelay
    return {
      artifact: { clips: Object.values(workspace.files) },
      diagnostics: [],
    }
  })
  const diff = vi.fn(async ({ artifact }: { artifact: Artifact }) => ({
    diff: { added: artifact.clips.filter((clip) => !source.clips.includes(clip)) },
  }))
  const commit = vi.fn(
    async ({
      commitId,
      expectedRevision,
      artifact,
    }: {
      commitId: string
      expectedRevision: number
      artifact: Artifact
    }): Promise<CodingWorkspaceAdapterCommitResult<number, Receipt>> => {
      const cached = commitResults.get(commitId)
      if (cached) return cached
      if (expectedRevision !== revision) return { status: 'conflict', actualRevision: revision }
      source = structuredClone(artifact)
      revision += 1
      const result = {
        status: 'committed' as const,
        revision,
        receipt: { saved: source.clips.length },
      }
      commitResults.set(commitId, result)
      return result
    },
  )
  const adapter = { capture, check, build, diff, commit } as unknown as CodingWorkspaceAdapter<
    Source,
    Workspace,
    Artifact,
    Diff,
    number,
    Receipt
  >
  return {
    adapter,
    capture,
    check,
    build,
    diff,
    commit,
    production: () => ({ revision, source }),
    externalEdit: () => {
      source = { clips: [...source.clips, 'user-change'] }
      revision += 1
    },
  }
}

const dirtyWorkspace = { files: { 'segments/opening.json': 'opening', 'segments/end.json': 'end' } }

describe('CodingWorkspaceCheckout', () => {
  it('captures the production source once and keeps all preparation isolated', async () => {
    const fake = fakeAdapter()
    const checkout = await createCodingWorkspaceCheckout(fake.adapter)

    expect(checkout.captured).toEqual({ revision: 4, source: { clips: ['opening'] } })
    expect((await checkout.check(dirtyWorkspace)).diagnostics).toEqual([])
    expect(await checkout.build(dirtyWorkspace)).toMatchObject({
      artifact: { clips: ['opening', 'end'] },
    })
    expect(await checkout.diff(dirtyWorkspace)).toMatchObject({ diff: { added: ['end'] } })
    expect(fake.capture).toHaveBeenCalledTimes(1)
    expect(fake.commit).not.toHaveBeenCalled()
    expect(fake.production()).toEqual({ revision: 4, source: { clips: ['opening'] } })
  })

  it('runs the compiler pipeline and atomically commits against the captured revision', async () => {
    const fake = fakeAdapter()
    const checkout = await createCodingWorkspaceCheckout(fake.adapter)

    const result = await checkout.commit({ commitId: 'commit-1', workspace: dirtyWorkspace })

    expect(result).toMatchObject({
      ok: true,
      revisionBefore: 4,
      revisionAfter: 5,
      diff: { added: ['end'] },
      receipt: { saved: 2 },
    })
    expect(fake.commit).toHaveBeenCalledWith(
      expect.objectContaining({ commitId: 'commit-1', expectedRevision: 4 }),
    )
    expect(fake.production()).toEqual({
      revision: 5,
      source: { clips: ['opening', 'end'] },
    })
  })

  it('returns a structured conflict without overwriting an external edit', async () => {
    const fake = fakeAdapter()
    const checkout = await createCodingWorkspaceCheckout(fake.adapter)
    fake.externalEdit()

    const result = await checkout.commit({ commitId: 'stale-commit', workspace: dirtyWorkspace })

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'SOURCE_REVISION_CONFLICT',
          expectedRevision: 4,
          actualRevision: 5,
          retryable: true,
        },
      ],
    })
    expect(fake.production()).toEqual({
      revision: 5,
      source: { clips: ['opening', 'user-change'] },
    })

    const repeated = await checkout.commit({
      commitId: 'another-stale-commit',
      workspace: dirtyWorkspace,
    })
    expect(repeated).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'SOURCE_REVISION_CONFLICT', actualRevision: 5 }],
    })
    expect(fake.commit).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent and repeated commits by commit id', async () => {
    let releaseBuild: () => void = () => undefined
    const buildDelay = new Promise<void>((resolve) => {
      releaseBuild = resolve
    })
    const fake = fakeAdapter({ buildDelay })
    const checkout = await createCodingWorkspaceCheckout(fake.adapter)

    const first = checkout.commit({ commitId: 'same-commit', workspace: dirtyWorkspace })
    const concurrent = checkout.commit({ commitId: 'same-commit', workspace: dirtyWorkspace })
    releaseBuild()
    const [firstResult, concurrentResult] = await Promise.all([first, concurrent])
    const repeated = await checkout.commit({ commitId: 'same-commit', workspace: dirtyWorkspace })

    expect(firstResult).toBe(concurrentResult)
    expect(repeated).toBe(firstResult)
    expect(fake.commit).toHaveBeenCalledTimes(1)
    expect(fake.production().revision).toBe(5)
  })

  it('does not build or commit a workspace that fails checking', async () => {
    const fake = fakeAdapter({ invalid: true })
    const checkout = await createCodingWorkspaceCheckout(fake.adapter)

    const result = await checkout.commit({ commitId: 'invalid-commit', workspace: dirtyWorkspace })

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'INVALID_SEGMENT', path: 'segments/opening.json' }],
    })
    expect(fake.build).not.toHaveBeenCalled()
    expect(fake.diff).not.toHaveBeenCalled()
    expect(fake.commit).not.toHaveBeenCalled()
  })

  it('rejects a different transaction while a commit is in progress', async () => {
    let releaseBuild: () => void = () => undefined
    const buildDelay = new Promise<void>((resolve) => {
      releaseBuild = resolve
    })
    const fake = fakeAdapter({ buildDelay })
    const checkout = await createCodingWorkspaceCheckout(fake.adapter)

    const first = checkout.commit({ commitId: 'commit-a', workspace: dirtyWorkspace })
    const second = await checkout.commit({ commitId: 'commit-b', workspace: dirtyWorkspace })
    releaseBuild()
    await first

    expect(second).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'COMMIT_IN_PROGRESS', retryable: true }],
    })
    expect(fake.commit).toHaveBeenCalledTimes(1)
  })
})
