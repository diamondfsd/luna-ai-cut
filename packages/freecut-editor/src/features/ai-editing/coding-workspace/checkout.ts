import {
  diagnosticsFromError,
  hasErrorDiagnostics,
  operationFailureDiagnostic,
  revisionConflictDiagnostic,
  type CodingWorkspaceDiagnostic,
} from './diagnostics'

export interface CodingWorkspaceSnapshot<TSource, TRevision extends string | number> {
  readonly revision: TRevision
  readonly source: TSource
}

export interface CodingWorkspaceCheckResult<TRevision extends string | number> {
  diagnostics: readonly CodingWorkspaceDiagnostic<TRevision>[]
}

export interface CodingWorkspaceBuildResult<
  TArtifact,
  TRevision extends string | number,
> extends CodingWorkspaceCheckResult<TRevision> {
  artifact?: TArtifact
}

export interface CodingWorkspaceDiffResult<
  TArtifact,
  TDiff,
  TRevision extends string | number,
> extends CodingWorkspaceBuildResult<TArtifact, TRevision> {
  diff?: TDiff
}

export interface CodingWorkspaceCommitRequest<
  TSource,
  TWorkspace,
  TArtifact,
  TRevision extends string | number,
> {
  commitId: string
  expectedRevision: TRevision
  base: CodingWorkspaceSnapshot<TSource, TRevision>
  workspace: TWorkspace
  artifact: TArtifact
}

export type CodingWorkspaceAdapterCommitResult<TRevision extends string | number, TReceipt> =
  | { status: 'committed'; revision: TRevision; receipt: TReceipt }
  | { status: 'conflict'; actualRevision: TRevision }

export interface CodingWorkspaceAdapter<
  TSource,
  TWorkspace,
  TArtifact,
  TDiff,
  TRevision extends string | number = number,
  TReceipt = undefined,
> {
  /** The only production read before commit. It creates the immutable checkout base. */
  capture(): Promise<CodingWorkspaceSnapshot<TSource, TRevision>>
  check(input: {
    base: CodingWorkspaceSnapshot<TSource, TRevision>
    workspace: TWorkspace
  }): Promise<CodingWorkspaceCheckResult<TRevision>>
  build(input: {
    base: CodingWorkspaceSnapshot<TSource, TRevision>
    workspace: TWorkspace
  }): Promise<CodingWorkspaceBuildResult<TArtifact, TRevision>>
  diff(input: {
    base: CodingWorkspaceSnapshot<TSource, TRevision>
    workspace: TWorkspace
    artifact: TArtifact
  }): Promise<{ diff: TDiff; diagnostics?: readonly CodingWorkspaceDiagnostic<TRevision>[] }>
  /** Must atomically compare expectedRevision and write, keyed idempotently by commitId. */
  commit(
    input: CodingWorkspaceCommitRequest<TSource, TWorkspace, TArtifact, TRevision>,
  ): Promise<CodingWorkspaceAdapterCommitResult<TRevision, TReceipt>>
}

export interface CodingWorkspaceCommitSuccess<
  TArtifact,
  TDiff,
  TRevision extends string | number,
  TReceipt,
> {
  ok: true
  commitId: string
  revisionBefore: TRevision
  revisionAfter: TRevision
  artifact: TArtifact
  diff: TDiff
  receipt: TReceipt
  diagnostics: readonly CodingWorkspaceDiagnostic<TRevision>[]
}

export interface CodingWorkspaceCommitFailure<TRevision extends string | number> {
  ok: false
  commitId: string
  diagnostics: readonly CodingWorkspaceDiagnostic<TRevision>[]
}

export type CodingWorkspaceCommitResult<
  TArtifact,
  TDiff,
  TRevision extends string | number,
  TReceipt,
> =
  | CodingWorkspaceCommitSuccess<TArtifact, TDiff, TRevision, TReceipt>
  | CodingWorkspaceCommitFailure<TRevision>

export interface CodingWorkspaceCommitInput<TWorkspace> {
  commitId: string
  workspace: TWorkspace
}

export class CodingWorkspaceCheckout<
  TSource,
  TWorkspace,
  TArtifact,
  TDiff,
  TRevision extends string | number = number,
  TReceipt = undefined,
> {
  readonly captured: CodingWorkspaceSnapshot<TSource, TRevision>
  private readonly commits = new Map<
    string,
    Promise<CodingWorkspaceCommitResult<TArtifact, TDiff, TRevision, TReceipt>>
  >()
  private activeCommitId: string | undefined
  private committedId: string | undefined
  private conflict: CodingWorkspaceDiagnostic<TRevision> | undefined

  constructor(
    private readonly adapter: CodingWorkspaceAdapter<
      TSource,
      TWorkspace,
      TArtifact,
      TDiff,
      TRevision,
      TReceipt
    >,
    captured: CodingWorkspaceSnapshot<TSource, TRevision>,
  ) {
    this.captured = captured
  }

  async check(workspace: TWorkspace): Promise<CodingWorkspaceCheckResult<TRevision>> {
    try {
      return await this.adapter.check({ base: this.captured, workspace })
    } catch (error) {
      return { diagnostics: diagnosticsFromError<TRevision>({ stage: 'check', error }) }
    }
  }

  async build(workspace: TWorkspace): Promise<CodingWorkspaceBuildResult<TArtifact, TRevision>> {
    const checked = await this.check(workspace)
    if (hasErrorDiagnostics(checked.diagnostics)) return checked
    try {
      const built = await this.adapter.build({ base: this.captured, workspace })
      return { ...built, diagnostics: [...checked.diagnostics, ...built.diagnostics] }
    } catch (error) {
      return {
        diagnostics: [
          ...checked.diagnostics,
          ...diagnosticsFromError<TRevision>({ stage: 'build', error }),
        ],
      }
    }
  }

  async diff(
    workspace: TWorkspace,
  ): Promise<CodingWorkspaceDiffResult<TArtifact, TDiff, TRevision>> {
    const built = await this.build(workspace)
    if (built.artifact === undefined || hasErrorDiagnostics(built.diagnostics)) return built
    try {
      const result = await this.adapter.diff({
        base: this.captured,
        workspace,
        artifact: built.artifact,
      })
      return {
        ...built,
        diff: result.diff,
        diagnostics: [...built.diagnostics, ...(result.diagnostics ?? [])],
      }
    } catch (error) {
      return {
        ...built,
        diagnostics: [
          ...built.diagnostics,
          ...diagnosticsFromError<TRevision>({ stage: 'diff', error }),
        ],
      }
    }
  }

  commit(
    input: CodingWorkspaceCommitInput<TWorkspace>,
  ): Promise<CodingWorkspaceCommitResult<TArtifact, TDiff, TRevision, TReceipt>> {
    const previous = this.commits.get(input.commitId)
    if (previous) return previous
    if (this.committedId) {
      return Promise.resolve(this.commitStateFailure(input.commitId, 'CHECKOUT_ALREADY_COMMITTED'))
    }
    if (this.conflict) {
      return Promise.resolve({
        ok: false,
        commitId: input.commitId,
        diagnostics: [this.conflict],
      })
    }
    if (this.activeCommitId) {
      return Promise.resolve(this.commitStateFailure(input.commitId, 'COMMIT_IN_PROGRESS'))
    }

    this.activeCommitId = input.commitId
    const pending = this.performCommit(input).finally(() => {
      if (this.activeCommitId === input.commitId) this.activeCommitId = undefined
    })
    this.commits.set(input.commitId, pending)
    return pending
  }

  private async performCommit(
    input: CodingWorkspaceCommitInput<TWorkspace>,
  ): Promise<CodingWorkspaceCommitResult<TArtifact, TDiff, TRevision, TReceipt>> {
    const prepared = await this.diff(input.workspace)
    if (
      prepared.artifact === undefined ||
      prepared.diff === undefined ||
      hasErrorDiagnostics(prepared.diagnostics)
    ) {
      return { ok: false, commitId: input.commitId, diagnostics: prepared.diagnostics }
    }

    try {
      const result = await this.adapter.commit({
        commitId: input.commitId,
        expectedRevision: this.captured.revision,
        base: this.captured,
        workspace: input.workspace,
        artifact: prepared.artifact,
      })
      if (result.status === 'conflict') {
        this.conflict = revisionConflictDiagnostic({
          expectedRevision: this.captured.revision,
          actualRevision: result.actualRevision,
        })
        return {
          ok: false,
          commitId: input.commitId,
          diagnostics: [...prepared.diagnostics, this.conflict],
        }
      }
      this.committedId = input.commitId
      return {
        ok: true,
        commitId: input.commitId,
        revisionBefore: this.captured.revision,
        revisionAfter: result.revision,
        artifact: prepared.artifact,
        diff: prepared.diff,
        receipt: result.receipt,
        diagnostics: prepared.diagnostics,
      }
    } catch (error) {
      return {
        ok: false,
        commitId: input.commitId,
        diagnostics: [
          ...prepared.diagnostics,
          ...diagnosticsFromError<TRevision>({ stage: 'commit', error }),
        ],
      }
    }
  }

  private commitStateFailure(
    commitId: string,
    code: 'CHECKOUT_ALREADY_COMMITTED' | 'COMMIT_IN_PROGRESS',
  ): CodingWorkspaceCommitFailure<TRevision> {
    const message =
      code === 'CHECKOUT_ALREADY_COMMITTED'
        ? '这个剪辑工程工作区已经提交。'
        : '这个剪辑工程工作区正在提交另一份修改。'
    return {
      ok: false,
      commitId,
      diagnostics: [
        {
          ...operationFailureDiagnostic({ stage: 'commit', error: new Error(message) }),
          code,
          retryable: code === 'COMMIT_IN_PROGRESS',
        } as CodingWorkspaceDiagnostic<TRevision>,
      ],
    }
  }
}

export async function createCodingWorkspaceCheckout<
  TSource,
  TWorkspace,
  TArtifact,
  TDiff,
  TRevision extends string | number = number,
  TReceipt = undefined,
>(
  adapter: CodingWorkspaceAdapter<TSource, TWorkspace, TArtifact, TDiff, TRevision, TReceipt>,
): Promise<CodingWorkspaceCheckout<TSource, TWorkspace, TArtifact, TDiff, TRevision, TReceipt>> {
  const captured = await adapter.capture()
  return new CodingWorkspaceCheckout(adapter, captured)
}
