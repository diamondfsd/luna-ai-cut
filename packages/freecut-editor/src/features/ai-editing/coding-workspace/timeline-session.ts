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
  type DurableSourceReplaceInput,
} from './durable-source-repository'
import { projectAgentWorkspaceToFiles } from './project-projection'
import { getAiEditingDocumentationFiles } from '../documentation/catalog'
import { VirtualEditingWorkspace } from './virtual-files'

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

  constructor(
    readonly workspace: VirtualEditingWorkspace,
    readonly repository: DurableEditingSourceRepository,
    private renderedProject: Project,
    private readonly availableMediaIds: ReadonlySet<string>,
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
    const session = new TimelineCodingSession(
      repository.workspace,
      repository,
      liveProject,
      availableMediaIds,
    )
    const compiled = await session.compileProject()
    session.renderedProject = compiled
    return session
  }

  private async compileProject(): Promise<Project> {
    const project = await projectFromSourceFiles({
      read: async (path) => (await this.repository.readSource(path)).content,
    })
    validateMediaIds(project, this.availableMediaIds)
    return project
  }

  private async refreshRenderer(): Promise<Project> {
    const project = await this.compileProject()
    await hydrateTimelineStoresFromProject(project)
    await updateProject(project.id, {
      name: project.name,
      description: project.description,
      duration: project.duration,
      metadata: project.metadata,
      timeline: project.timeline,
      updatedAt: Date.now(),
    })
    this.renderedProject = project
    return project
  }

  private scheduleRendererRefresh(): void {
    this.projectionRequested += 1
    this.ensureProjectionWorker()
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
      try {
        await this.refreshRenderer()
        this.projectionApplied = target
      } catch {
        // Multi-file edits can be temporarily incomplete. Keep the last valid
        // preview and retry automatically after the next source mutation.
      }
      this.projectionAttempted = target
    }
  }

  private async waitForBackgroundProjection(): Promise<void> {
    while (this.projectionWorker) await this.projectionWorker
  }

  async finalizeRenderer(): Promise<void> {
    await this.waitForBackgroundProjection()
    if (this.projectionApplied >= this.projectionRequested) return
    try {
      await this.refreshRenderer()
      this.projectionApplied = this.projectionRequested
    } catch {
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

  async removeSource(path: string, expectedContent: string) {
    const result = await this.repository.removeSource(path, expectedContent)
    this.changedSourcePaths.add(path)
    this.scheduleRendererRefresh()
    return result
  }

  async check(): Promise<TimelineBuildResult> {
    try {
      await this.waitForBackgroundProjection()
      const artifact = await this.refreshRenderer()
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
    await this.refreshRenderer()
    this.projectionApplied = this.projectionRequested
    const result = await this.repository.commit(message, this.changedSourcePaths)
    this.changedSourcePaths.clear()
    return result
  }
}
