import { getProject, updateProject } from '@freecut/infrastructure/storage'
import {
  buildTimelineFromStores,
  hydrateTimelineStoresFromProject,
} from '@freecut/features/timeline/stores/timeline-persistence'
import type { Project } from '@freecut/types/project'
import {
  buildAgentWorkspaceDocument,
  idFromAgentRef,
} from '../workspace-document/build-workspace-document'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import {
  projectFromSourceFiles,
  projectToSourceFiles,
} from '@freecut/features/project-source/project-source-codec'
import type { CodingWorkspaceDiagnostic } from './diagnostics'
import {
  DurableEditingSourceRepository,
  type DurableSourceChange,
  type DurableSourceReplaceInput,
} from './durable-source-repository'
import { projectAgentWorkspaceToFiles } from './project-projection'
import { getAiEditingDocumentationFiles } from '../documentation/catalog'
import { VirtualEditingWorkspace, type VirtualFileInput } from './virtual-files'
import { validateAiEditingTimelineSource } from './timeline-source-validation'
import { logAiEditingDiagnostic } from '../diagnostic-log'

const RENDERER_REFRESH_DEBOUNCE_MS = 1_000

export interface TimelineProgramSummary {
  operationCount: number
  operationTypes: Record<string, number>
  changedRanges: Array<{ start: number; end: number }>
}

interface TimelineBuildResult {
  artifact?: Project
  diagnostics: readonly CodingWorkspaceDiagnostic[]
}

function projectDiagnostic(error: unknown) {
  return {
    code: 'PROJECT_SOURCE_INVALID',
    message: error instanceof Error ? error.message : '视频工程源码无法编译。',
    severity: 'error' as const,
    stage: 'check' as const,
    retryable: true,
  } satisfies CodingWorkspaceDiagnostic
}

function validateMediaIds(project: Project, availableMediaIds: ReadonlySet<string>): void {
  const timelines = [project.timeline, ...(project.timeline?.compositions ?? [])]
  for (const timeline of timelines) {
    for (const item of timeline?.items ?? []) {
      if (!item.mediaId) continue
      if (item.mediaId.startsWith('media:')) {
        throw new Error(
          `片段“${item.label}”的 mediaId 使用了工具引用“${item.mediaId}”。请改用 media/index.json 中对应的 id。`,
        )
      }
      if (!availableMediaIds.has(item.mediaId)) {
        throw new Error(
          `片段“${item.label}”引用的素材“${item.mediaId}”不在当前项目的 media/index.json 中。`,
        )
      }
    }
  }
}

export function summarizeTimelineProgram(project: Project): TimelineProgramSummary {
  const clipCount = project.timeline?.items.length ?? 0
  return {
    operationCount: clipCount,
    operationTypes: { clip: clipCount },
    changedRanges: [],
  }
}

export class TimelineCodingSession {
  private readonly changedSourcePaths = new Set<string>()
  private projectionRequested = 0
  private projectionAttempted = 0
  private projectionApplied = 0
  private projectionWorker: Promise<void> | null = null
  private projectionTimer: ReturnType<typeof setTimeout> | null = null
  private requestedSnapshot: readonly VirtualFileInput[] | null = null

  constructor(
    readonly workspace: VirtualEditingWorkspace,
    readonly repository: DurableEditingSourceRepository,
    private renderedProject: Project,
    private readonly availableMediaIds: ReadonlySet<string>,
    private readonly mediaHasAudioById: ReadonlyMap<string, boolean>,
  ) {}

  static async create(): Promise<TimelineCodingSession> {
    const workspaceDocument = await buildAgentWorkspaceDocument()
    const storedProject = await getProject(workspaceDocument.project.id)
    if (!storedProject) throw new Error('当前视频工程不存在。')
    const liveProject: Project = {
      ...storedProject,
      timeline: buildTimelineFromStores(),
    }
    const sourceFiles = projectToSourceFiles(liveProject)
    const evidenceFiles = projectAgentWorkspaceToFiles(workspaceDocument).filter(
      (file) => file.path.startsWith('media/') || file.path.startsWith('evidence/'),
    )
    const documentationFiles = getAiEditingDocumentationFiles()
    const bridge = getEmbeddedHostBridge().editingSourceGit
    if (!bridge) throw new Error('当前环境无法保存视频工程源码。')
    const repository = await DurableEditingSourceRepository.open({
      projectId: liveProject.id,
      sourceRevision: 0,
      projectedFiles: [
        ...Object.entries(sourceFiles).map(([path, content]) => ({ path, content })),
        ...evidenceFiles,
        ...documentationFiles,
      ],
      bridge,
    })
    const availableMediaIds = new Set(
      workspaceDocument.media.map((media) => idFromAgentRef(media.ref, 'media')),
    )
    const mediaHasAudioById = new Map(
      workspaceDocument.media.map((media) => [
        idFromAgentRef(media.ref, 'media'),
        media.hasAudio === true,
      ]),
    )
    const session = new TimelineCodingSession(
      repository.workspace,
      repository,
      liveProject,
      availableMediaIds,
      mediaHasAudioById,
    )
    const compiled = await session.compileProject()
    session.renderedProject = compiled
    return session
  }

  private async compileProject(
    validateSemantics = false,
    snapshot: readonly VirtualFileInput[] = this.repository.sourceSnapshot(),
  ): Promise<Project> {
    const files = new Map(snapshot.map((file) => [file.path, file.content]))
    const project = await projectFromSourceFiles({
      read: async (path) => {
        const content = files.get(path)
        if (content === undefined) throw new Error(`剪辑源码文件不存在：${path}`)
        return content
      },
      list: async (directory) => {
        const prefix = directory ? `${directory}/` : ''
        const entries = new Map<string, 'file' | 'directory'>()
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue
          const remainder = path.slice(prefix.length)
          if (!remainder) continue
          const separator = remainder.indexOf('/')
          const name = separator < 0 ? remainder : remainder.slice(0, separator)
          entries.set(`${prefix}${name}`, separator < 0 ? 'file' : 'directory')
        }
        return [...entries].map(([path, type]) => ({ path, type }))
          .sort((left, right) => left.path.localeCompare(right.path))
      },
    })
    validateMediaIds(project, this.availableMediaIds)
    if (validateSemantics) validateAiEditingTimelineSource(project, this.mediaHasAudioById)
    return project
  }

  private async applyPreview(
    snapshot: readonly VirtualFileInput[],
    validateSemantics = false,
  ): Promise<Project> {
    const project = await this.compileProject(validateSemantics, snapshot)
    await hydrateTimelineStoresFromProject(project, { preserveZoom: true })
    this.renderedProject = project
    return project
  }

  private async persistProject(project: Project): Promise<void> {
    await updateProject(project.id, {
      name: project.name,
      description: project.description,
      duration: project.duration,
      metadata: project.metadata,
      timeline: project.timeline,
      updatedAt: Date.now(),
    })
  }

  private scheduleRendererRefresh(): void {
    this.projectionRequested += 1
    this.requestedSnapshot = this.repository.sourceSnapshot()
    const timerAlreadyPending = Boolean(this.projectionTimer)
    logAiEditingDiagnostic('info', 'preview.scheduled', {
      request: this.projectionRequested,
      debounceMs: RENDERER_REFRESH_DEBOUNCE_MS,
      sourceFiles: this.requestedSnapshot.length,
      changedPaths: [...this.changedSourcePaths],
      timerAlreadyPending,
    })
    if (this.projectionTimer) return
    this.projectionTimer = setTimeout(() => {
      this.projectionTimer = null
      logAiEditingDiagnostic('info', 'preview.debounce-fired', {
        request: this.projectionRequested,
      })
      this.ensureProjectionWorker()
    }, RENDERER_REFRESH_DEBOUNCE_MS)
  }

  private ensureProjectionWorker(): void {
    if (this.projectionWorker) return
    const worker = this.runProjectionWorker()
    this.projectionWorker = worker
    void worker.finally(() => {
      if (this.projectionWorker !== worker) return
      this.projectionWorker = null
      if (this.projectionAttempted < this.projectionRequested) this.ensureProjectionWorker()
    })
  }

  private async runProjectionWorker(): Promise<void> {
    while (this.projectionAttempted < this.projectionRequested) {
      const target = this.projectionRequested
      const snapshot = this.requestedSnapshot
      const startedAt = performance.now()
      logAiEditingDiagnostic('info', 'preview.compile-start', {
        request: target,
        sourceFiles: snapshot?.length ?? 0,
      })
      try {
        if (snapshot) {
          const project = await this.compileProject(true, snapshot)
          if (target !== this.projectionRequested) {
            logAiEditingDiagnostic('info', 'preview.skipped-stale', {
              request: target,
              latestRequest: this.projectionRequested,
              durationMs: Math.round(performance.now() - startedAt),
            })
          } else {
            await hydrateTimelineStoresFromProject(project, { preserveZoom: true })
            if (target !== this.projectionRequested) {
              logAiEditingDiagnostic('info', 'preview.skipped-stale', {
                request: target,
                latestRequest: this.projectionRequested,
                durationMs: Math.round(performance.now() - startedAt),
              })
            } else {
              await this.persistProject(project)
              this.renderedProject = project
              this.projectionApplied = target
              logAiEditingDiagnostic('info', 'preview.applied', {
                request: target,
                durationMs: Math.round(performance.now() - startedAt),
                trackCount: project.timeline?.tracks.length ?? 0,
                itemCount: project.timeline?.items.length ?? 0,
                durationSeconds: project.duration,
              })
            }
          }
        }
      } catch (error) {
        logAiEditingDiagnostic('warn', 'preview.rejected', {
          request: target,
          durationMs: Math.round(performance.now() - startedAt),
          reason: error instanceof Error ? error.message : String(error),
          retainedRequest: this.projectionApplied,
        })
        // Multi-file edits can be temporarily incomplete. Keep the last valid
        // preview and retry automatically after the next source mutation.
      }
      this.projectionAttempted = target
    }
  }

  private async waitForBackgroundProjection(): Promise<void> {
    if (this.projectionTimer) {
      clearTimeout(this.projectionTimer)
      this.projectionTimer = null
      this.ensureProjectionWorker()
    }
    while (this.projectionWorker) await this.projectionWorker
  }

  async finalizeRenderer(): Promise<void> {
    await this.waitForBackgroundProjection()
    if (this.projectionApplied >= this.projectionRequested) {
      logAiEditingDiagnostic('info', 'preview.finalized', {
        request: this.projectionRequested,
        alreadyApplied: true,
      })
      return
    }
    const startedAt = performance.now()
    logAiEditingDiagnostic('info', 'preview.final-apply-start', {
      request: this.projectionRequested,
    })
    try {
      const snapshot = this.requestedSnapshot ?? this.repository.sourceSnapshot()
      const project = await this.applyPreview(snapshot, true)
      await this.persistProject(project)
      this.projectionApplied = this.projectionRequested
      logAiEditingDiagnostic('info', 'preview.final-applied', {
        request: this.projectionRequested,
        durationMs: Math.round(performance.now() - startedAt),
      })
    } catch (error) {
      logAiEditingDiagnostic('warn', 'preview.final-rejected', {
        request: this.projectionRequested,
        durationMs: Math.round(performance.now() - startedAt),
        reason: error instanceof Error ? error.message : String(error),
        retainedRequest: this.projectionApplied,
      })
      // Validation and commit report actionable source errors. Turn cleanup
      // must never replace the assistant's result with a preview error.
    }
  }

  async replaceSource(input: DurableSourceReplaceInput) {
    const result = await this.repository.replaceSource(input)
    if (result.changed) {
      this.changedSourcePaths.add(input.path)
      this.scheduleRendererRefresh()
    }
    return result
  }

  async createSource(path: string, content: string) {
    const result = await this.repository.createSource(path, content)
    this.changedSourcePaths.add(path)
    this.scheduleRendererRefresh()
    return result
  }

  async removeSource(path: string, expectedRevision: string) {
    const result = await this.repository.removeSource(path, expectedRevision)
    this.changedSourcePaths.add(path)
    this.scheduleRendererRefresh()
    return result
  }

  async applySourceChanges(changes: DurableSourceChange[]) {
    const result = await this.repository.applySourceChanges(changes)
    for (const change of changes) this.changedSourcePaths.add(change.path)
    this.scheduleRendererRefresh()
    return result
  }

  async currentProject(): Promise<Project> {
    return this.compileProject(false)
  }

  async check(): Promise<TimelineBuildResult> {
    try {
      await this.waitForBackgroundProjection()
      const snapshot = this.repository.sourceSnapshot()
      const artifact = await this.applyPreview(snapshot, true)
      this.projectionApplied = this.projectionRequested
      return { artifact, diagnostics: [] }
    } catch (error) {
      return { diagnostics: [projectDiagnostic(error)] }
    }
  }

  async promptContext() {
    const sourceStatus = await this.repository.status()
    return {
      kind: 'luna-video-project-source',
      project: {
        id: this.renderedProject.id,
        name: this.renderedProject.name,
        metadata: this.renderedProject.metadata,
      },
      repository: {
        branch: sourceStatus.branch,
        headCommitId: sourceStatus.headCommitId,
        dirty: !sourceStatus.clean,
        changedFiles: sourceStatus.entries,
        entrypoint: 'manifest.json',
        writableRoots: ['manifest.json', 'sequences/', 'components/'],
        readOnlyRoots: ['media/', 'evidence/', 'docs/'],
      },
    }
  }

  async commitSource(message: string) {
    if (this.changedSourcePaths.size === 0) throw new Error('本轮没有需要提交的剪辑源码改动。')
    await this.waitForBackgroundProjection()
    const snapshot = this.repository.sourceSnapshot()
    const project = await this.applyPreview(snapshot, true)
    this.projectionApplied = this.projectionRequested
    const result = await this.repository.commit(message)
    await this.persistProject(project)
    this.changedSourcePaths.clear()
    return result
  }
}
