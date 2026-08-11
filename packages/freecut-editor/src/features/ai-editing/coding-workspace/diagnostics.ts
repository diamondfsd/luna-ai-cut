export type CodingWorkspaceDiagnosticSeverity = 'error' | 'warning'

export type CodingWorkspaceDiagnosticStage =
  | 'checkout'
  | 'check'
  | 'build'
  | 'test'
  | 'diff'
  | 'commit'

export interface CodingWorkspaceDiagnostic<TRevision extends string | number = string | number> {
  code: string
  message: string
  severity: CodingWorkspaceDiagnosticSeverity
  stage: CodingWorkspaceDiagnosticStage
  retryable: boolean
  path?: string
  expectedRevision?: TRevision
  actualRevision?: TRevision
  details?: Readonly<Record<string, unknown>>
}

export class CodingWorkspaceDiagnosticError<
  TRevision extends string | number = string | number,
> extends Error {
  readonly diagnostics: readonly CodingWorkspaceDiagnostic<TRevision>[]

  constructor(
    diagnostics:
      | CodingWorkspaceDiagnostic<TRevision>
      | readonly CodingWorkspaceDiagnostic<TRevision>[],
  ) {
    const normalized = Array.isArray(diagnostics) ? diagnostics : [diagnostics]
    super(normalized[0]?.message ?? '剪辑工程处理失败。')
    this.name = 'CodingWorkspaceDiagnosticError'
    this.diagnostics = normalized
  }
}

export function revisionConflictDiagnostic<TRevision extends string | number>(input: {
  expectedRevision: TRevision
  actualRevision: TRevision
}): CodingWorkspaceDiagnostic<TRevision> {
  return {
    code: 'SOURCE_REVISION_CONFLICT',
    message: '剪辑工程在编辑期间发生了变化，请先查看新版本与当前工作的差异。',
    severity: 'error',
    stage: 'commit',
    retryable: true,
    expectedRevision: input.expectedRevision,
    actualRevision: input.actualRevision,
  }
}

export function operationFailureDiagnostic(input: {
  stage: CodingWorkspaceDiagnosticStage
  error: unknown
}): CodingWorkspaceDiagnostic {
  return {
    code: `${input.stage.toUpperCase()}_FAILED`,
    message: input.error instanceof Error ? input.error.message : '剪辑工程处理失败。',
    severity: 'error',
    stage: input.stage,
    retryable: false,
  }
}

export function diagnosticsFromError<TRevision extends string | number>(input: {
  stage: CodingWorkspaceDiagnosticStage
  error: unknown
}): readonly CodingWorkspaceDiagnostic<TRevision>[] {
  if (input.error instanceof CodingWorkspaceDiagnosticError) {
    return input.error.diagnostics as readonly CodingWorkspaceDiagnostic<TRevision>[]
  }
  return [operationFailureDiagnostic(input) as CodingWorkspaceDiagnostic<TRevision>]
}

export function hasErrorDiagnostics(diagnostics: readonly CodingWorkspaceDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}
