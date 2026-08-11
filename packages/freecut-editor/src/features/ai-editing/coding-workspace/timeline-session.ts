import { applyEditProgram } from '../edit-program/apply-edit-program'
import type { EditOperation, EditProgram, EditProgramApplyResult } from '../edit-program/types'
import { getTimelineRevision } from '../evidence'
import { buildAgentWorkspaceDocument } from '../workspace-document/build-workspace-document'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { runTimelineAcceptance, type TimelineAcceptanceMetrics } from './acceptance'
import {
  createTimelineBuildPublication,
  fingerprintTimelineBuild,
  ProjectTimelineBuildStateStore,
  type TimelineBuildStateStore,
} from './build-state'
import {
  createCodingWorkspaceCheckout,
  type CodingWorkspaceAdapter,
  type CodingWorkspaceCheckout,
} from './checkout'
import type { CodingWorkspaceDiagnostic } from './diagnostics'
import { DurableEditingSourceRepository } from './durable-source-repository'
import { projectAgentWorkspaceToFiles } from './project-projection'
import { compileEditingSources, SourceCompilerError } from './source-compiler'
import {
  VirtualEditingWorkspace,
  type VirtualFileInput,
  type VirtualFilePatch,
} from './virtual-files'

export interface TimelineSourceSnapshot {
  project: {
    id: string
    title: string
    width: number
    height: number
    fps: number
    duration: number
  }
  counts: {
    media: number
    tracks: number
    clips: number
    transitions: number
  }
}

export interface TimelineProgramDiff {
  operationCount: number
  operationTypes: Record<string, number>
  changedRanges: Array<{ start: number; end: number }>
  created: string[]
  updated: string[]
  removed: string[]
  transitionsChanged: number
}

export type TimelineProgramSummary = Pick<
  TimelineProgramDiff,
  'operationCount' | 'operationTypes' | 'changedRanges'
>

export type TimelineTestResult =
  | {
      passed: false
      files: []
      results: []
      diagnostics: readonly CodingWorkspaceDiagnostic<number>[]
    }
  | {
      passed: boolean
      files: string[]
      results: ReturnType<typeof runTimelineAcceptance>['results']
      diagnostics: readonly CodingWorkspaceDiagnostic<number>[]
      metrics: TimelineAcceptanceMetrics
    }

export type TimelineCheckout = CodingWorkspaceCheckout<
  TimelineSourceSnapshot,
  VirtualEditingWorkspace,
  EditProgram,
  TimelineProgramDiff,
  number,
  EditProgramApplyResult
>

type TimelineCommitSuccess = Extract<Awaited<ReturnType<TimelineCheckout['commit']>>, { ok: true }>

function sourceDiagnostic(
  error: unknown,
  stage: 'check' | 'build',
): CodingWorkspaceDiagnostic<number> {
  if (error instanceof SourceCompilerError) {
    return {
      code: error.code,
      message: error.message,
      severity: 'error',
      stage,
      retryable: false,
      ...(error.path ? { path: error.path } : {}),
    }
  }
  return {
    code: `${stage.toUpperCase()}_FAILED`,
    message: error instanceof Error ? error.message : '剪辑源码处理失败。',
    severity: 'error',
    stage,
    retryable: false,
  }
}

function operationRange(operation: EditOperation): { start: number; end: number } | undefined {
  if (operation.type === 'replaceRange') return operation.range
  if (operation.type === 'insertClip') {
    return { start: operation.clip.start, end: operation.clip.start + operation.clip.duration }
  }
  if (operation.type === 'insertText') {
    return { start: operation.text.start, end: operation.text.start + operation.text.duration }
  }
  if (operation.type === 'insertHtml') {
    return { start: operation.html.start, end: operation.html.start + operation.html.duration }
  }
  return undefined
}

export function summarizeTimelineProgram(program: EditProgram): TimelineProgramSummary {
  const operationTypes: Record<string, number> = {}
  const changedRanges: Array<{ start: number; end: number }> = []
  for (const operation of program.operations) {
    operationTypes[operation.type] = (operationTypes[operation.type] ?? 0) + 1
    const range = operationRange(operation)
    if (range) changedRanges.push(range)
  }
  return { operationCount: program.operations.length, operationTypes, changedRanges }
}

class TimelineCodingAdapter implements CodingWorkspaceAdapter<
  TimelineSourceSnapshot,
  VirtualEditingWorkspace,
  EditProgram,
  TimelineProgramDiff,
  number,
  EditProgramApplyResult
> {
  private capturedProjection?: {
    projectId: string
    revision: number
    files: VirtualFileInput[]
  }

  async capture() {
    const workspace = await buildAgentWorkspaceDocument()
    this.capturedProjection = {
      projectId: workspace.project.id,
      revision: workspace.revision,
      files: projectAgentWorkspaceToFiles(workspace),
    }
    return {
      revision: workspace.revision,
      source: {
        project: workspace.project,
        counts: {
          media: workspace.media.length,
          tracks: workspace.tracks.length,
          clips: workspace.clips.length,
          transitions: workspace.transitions.length,
        },
      },
    }
  }

  takeProjection() {
    if (!this.capturedProjection) throw new Error('剪辑源码工作区尚未创建。')
    return this.capturedProjection
  }

  async check(input: {
    base: { revision: number; source: TimelineSourceSnapshot }
    workspace: VirtualEditingWorkspace
  }) {
    try {
      compileEditingSources({
        workspace: input.workspace,
        baseRevision: input.base.revision,
        projectId: input.base.source.project.id,
        mode: 'preview',
      })
      return { diagnostics: [] }
    } catch (error) {
      return { diagnostics: [sourceDiagnostic(error, 'check')] }
    }
  }

  async build(input: {
    base: { revision: number; source: TimelineSourceSnapshot }
    workspace: VirtualEditingWorkspace
  }) {
    try {
      const artifact = compileEditingSources({
        workspace: input.workspace,
        baseRevision: input.base.revision,
        projectId: input.base.source.project.id,
        mode: 'commit',
      })
      await applyEditProgram({ ...artifact, mode: 'preview' }, { enforceSingleShot: false })
      return {
        artifact,
        diagnostics: [],
      }
    } catch (error) {
      return { diagnostics: [sourceDiagnostic(error, 'build')] }
    }
  }

  async diff(input: { artifact: EditProgram }) {
    const preview = await applyEditProgram(
      { ...input.artifact, mode: 'preview' },
      { enforceSingleShot: false },
    )
    return {
      diff: {
        ...summarizeTimelineProgram(input.artifact),
        ...preview.diff,
      },
    }
  }

  async commit(input: { expectedRevision: number; artifact: EditProgram }) {
    const actualRevision = getTimelineRevision()
    if (actualRevision !== input.expectedRevision) {
      return { status: 'conflict' as const, actualRevision }
    }
    const result = await applyEditProgram(input.artifact, { enforceSingleShot: false })
    return { status: 'committed' as const, revision: result.revisionAfter, receipt: result }
  }
}

export class TimelineCodingSession {
  private pendingPublication?: {
    commitId: string
    publication: ReturnType<typeof createTimelineBuildPublication>
    result: TimelineCommitSuccess
  }

  constructor(
    readonly workspace: VirtualEditingWorkspace,
    readonly repository: DurableEditingSourceRepository,
    private readonly checkout: TimelineCheckout,
    private readonly buildState: TimelineBuildStateStore = new ProjectTimelineBuildStateStore(),
  ) {}

  static async create(): Promise<TimelineCodingSession> {
    const adapter = new TimelineCodingAdapter()
    const checkout = await createCodingWorkspaceCheckout(adapter)
    const projection = adapter.takeProjection()
    const bridge = getEmbeddedHostBridge().editingSourceGit
    if (!bridge) throw new Error('当前环境无法保存剪辑源码。')
    const repository = await DurableEditingSourceRepository.open({
      projectId: projection.projectId,
      sourceRevision: projection.revision,
      projectedFiles: projection.files,
      bridge,
    })
    return new TimelineCodingSession(repository.workspace, repository, checkout)
  }

  applyPatch(patch: VirtualFilePatch) {
    return this.repository.applyPatch(patch)
  }

  check() {
    return this.checkout.check(this.workspace)
  }

  build() {
    return this.checkout.build(this.workspace)
  }

  async test(): Promise<TimelineTestResult> {
    const built = await this.checkout.build(this.workspace)
    if (
      built.artifact === undefined ||
      built.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ) {
      return { passed: false, files: [], results: [], diagnostics: built.diagnostics }
    }
    const acceptance = runTimelineAcceptance(this.workspace, built.artifact)
    return {
      ...acceptance,
      diagnostics: [...built.diagnostics, ...acceptance.diagnostics],
    }
  }

  diff() {
    return this.checkout.diff(this.workspace)
  }

  async promptContext() {
    const sourceStatus = await this.repository.status()
    return {
      kind: 'luna-editing-source-repository',
      checkoutRevision: this.checkout.captured.revision,
      project: this.checkout.captured.source.project,
      counts: this.checkout.captured.source.counts,
      repository: {
        branch: sourceStatus.branch,
        headCommitId: sourceStatus.headCommitId,
        workspaceRevision: this.workspace.revision,
        dirty: !sourceStatus.clean,
        changedFiles: sourceStatus.entries,
        entrypoint: 'manifest.json',
        writableRoots: ['manifest.json', 'sequences/', 'segments/', 'components/', 'tests/'],
        readOnlyRoots: ['media/', 'evidence/'],
      },
    }
  }

  async commitSource(message: string) {
    return this.repository.commit(message)
  }

  async publish(commitId: string) {
    return this.repository.runAtCleanHead(commitId, async () => {
      if (this.pendingPublication?.commitId === commitId) {
        await this.buildState.save(this.repository.projectId, this.pendingPublication.publication)
        const result = this.pendingPublication.result
        this.pendingPublication = undefined
        return result
      }

      const prepared = await this.checkout.diff(this.workspace)
      if (
        prepared.artifact === undefined ||
        prepared.diff === undefined ||
        prepared.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ) {
        return { ok: false as const, commitId, diagnostics: prepared.diagnostics }
      }

      const buildFingerprint = await fingerprintTimelineBuild(prepared.artifact)
      const previous = await this.buildState.load(this.repository.projectId)
      if (previous?.sourceCommitId === commitId) {
        if (previous.buildFingerprint !== buildFingerprint) {
          return {
            ok: false as const,
            commitId,
            diagnostics: [
              {
                code: 'PUBLISHED_BUILD_MISMATCH',
                message: '这个源码版本与已经发布的构建不一致，请创建新的源码提交。',
                severity: 'error' as const,
                stage: 'commit' as const,
                retryable: false,
                details: {
                  publishedFingerprint: previous.buildFingerprint,
                  currentFingerprint: buildFingerprint,
                },
              },
            ],
          }
        }
        if (this.checkout.captured.revision === previous.revisionAfter) {
          return {
            ok: true as const,
            commitId,
            revisionBefore: previous.revisionBefore,
            revisionAfter: previous.revisionAfter,
            artifact: prepared.artifact,
            diff: prepared.diff,
            receipt: structuredClone(previous.receipt),
            diagnostics: prepared.diagnostics,
          }
        }
      }

      const result = await this.checkout.commit({ commitId, workspace: this.workspace })
      if (!result.ok) return result
      const publication = createTimelineBuildPublication({
        sourceCommitId: commitId,
        buildFingerprint,
        receipt: result.receipt,
      })
      this.pendingPublication = { commitId, publication, result }
      await this.buildState.save(this.repository.projectId, publication)
      this.pendingPublication = undefined
      return result
    })
  }
}
