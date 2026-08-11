import { describe, expect, it, vi } from 'vite-plus/test'
import {
  createCodingWorkspaceWorkingCopy,
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
  const commitResults = new Map<
    string,
    CodingWorkspaceAdapterCommitResult<number, Receipt, Source>
  >()
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
    }): Promise<CodingWorkspaceAdapterCommitResult<number, Receipt, Source>> => {
      const cached = commitResults.get(commitId)
      if (cached) return cached
      if (expectedRevision !== revision) return { status: 'conflict', actualRevision: revision }
      source = structuredClone(artifact)
      revision += 1
      const result = {
        status: 'committed' as const,
        revision,
        source: structuredClone(source),
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

describe('CodingWorkspaceWorkingCopy', () => {
  it('captures the production source once and keeps all preparation isolated', async () => {
    const fake = fakeAdapter()
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)

    expect(workingCopy.baseline).toEqual({ revision: 4, source: { clips: ['opening'] } })
    expect((await workingCopy.check(dirtyWorkspace)).diagnostics).toEqual([])
    expect(await workingCopy.build(dirtyWorkspace)).toMatchObject({
      artifact: { clips: ['opening', 'end'] },
    })
    expect(await workingCopy.diff(dirtyWorkspace)).toMatchObject({ diff: { added: ['end'] } })
    expect(fake.capture).toHaveBeenCalledTimes(1)
    expect(fake.commit).not.toHaveBeenCalled()
    expect(fake.production()).toEqual({ revision: 4, source: { clips: ['opening'] } })
  })

  it('runs the compiler pipeline and atomically commits against the baseline revision', async () => {
    const fake = fakeAdapter()
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)

    const result = await workingCopy.commit({ commitId: 'commit-1', workspace: dirtyWorkspace })

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
    expect(workingCopy.baseline).toEqual(fake.production())
  })

  it('returns a structured conflict without overwriting an external edit', async () => {
    const fake = fakeAdapter()
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)
    fake.externalEdit()

    const result = await workingCopy.commit({
      commitId: 'stale-commit',
      workspace: dirtyWorkspace,
    })

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

    const repeated = await workingCopy.commit({
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
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)

    const first = workingCopy.commit({ commitId: 'same-commit', workspace: dirtyWorkspace })
    const concurrent = workingCopy.commit({ commitId: 'same-commit', workspace: dirtyWorkspace })
    releaseBuild()
    const [firstResult, concurrentResult] = await Promise.all([first, concurrent])
    const repeated = await workingCopy.commit({
      commitId: 'same-commit',
      workspace: dirtyWorkspace,
    })

    expect(firstResult).toBe(concurrentResult)
    expect(repeated).toBe(firstResult)
    expect(fake.commit).toHaveBeenCalledTimes(1)
    expect(fake.production().revision).toBe(5)
  })

  it('advances the baseline and publishes consecutive phases from one working copy', async () => {
    const fake = fakeAdapter()
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)
    const firstWorkspace = {
      files: { 'segments/opening.json': 'opening', 'segments/middle.json': 'middle' },
    }
    const secondWorkspace = {
      files: {
        'segments/opening.json': 'opening',
        'segments/middle.json': 'middle',
        'segments/end.json': 'end',
      },
    }

    const first = await workingCopy.commit({ commitId: 'phase-1', workspace: firstWorkspace })
    const second = await workingCopy.commit({ commitId: 'phase-2', workspace: secondWorkspace })

    expect(first).toMatchObject({ ok: true, revisionBefore: 4, revisionAfter: 5 })
    expect(second).toMatchObject({
      ok: true,
      revisionBefore: 5,
      revisionAfter: 6,
      diff: { added: ['end'] },
    })
    expect(fake.commit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ commitId: 'phase-2', expectedRevision: 5 }),
    )
    expect(workingCopy.baseline).toEqual({
      revision: 6,
      source: { clips: ['opening', 'middle', 'end'] },
    })
  })

  it('keeps the advanced baseline unchanged when a later phase conflicts', async () => {
    const fake = fakeAdapter()
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)
    await workingCopy.commit({ commitId: 'phase-1', workspace: dirtyWorkspace })
    const baselineAfterFirst = structuredClone(workingCopy.baseline)
    fake.externalEdit()

    const conflicted = await workingCopy.commit({
      commitId: 'phase-2',
      workspace: { files: { ...dirtyWorkspace.files, 'segments/credits.json': 'credits' } },
    })

    expect(conflicted).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'SOURCE_REVISION_CONFLICT', expectedRevision: 5, actualRevision: 6 }],
    })
    expect(workingCopy.baseline).toEqual(baselineAfterFirst)
  })

  it('does not build or commit a workspace that fails checking', async () => {
    const fake = fakeAdapter({ invalid: true })
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)

    const result = await workingCopy.commit({
      commitId: 'invalid-commit',
      workspace: dirtyWorkspace,
    })

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
    const workingCopy = await createCodingWorkspaceWorkingCopy(fake.adapter)

    const first = workingCopy.commit({ commitId: 'commit-a', workspace: dirtyWorkspace })
    const second = await workingCopy.commit({ commitId: 'commit-b', workspace: dirtyWorkspace })
    releaseBuild()
    await first

    expect(second).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'COMMIT_IN_PROGRESS', retryable: true }],
    })
    expect(fake.commit).toHaveBeenCalledTimes(1)
  })
})
