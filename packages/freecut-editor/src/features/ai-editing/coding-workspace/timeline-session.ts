import { getProject, updateProject } from '@freecut/infrastructure/storage'
import {
  buildTimelineFromStores,
  hydrateTimelineStoresFromProject,
} from '@freecut/features/timeline/stores/timeline-persistence'
import type { Project } from '@freecut/types/project'
import { buildAgentWorkspaceDocument } from '../workspace-document/build-workspace-document'
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

  constructor(
    readonly workspace: VirtualEditingWorkspace,
    readonly repository: DurableEditingSourceRepository,
    private renderedProject: Project,
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
    const session = new TimelineCodingSession(repository.workspace, repository, liveProject)
    const compiled = await session.compileProject()
    session.renderedProject = compiled
    return session
  }

  private compileProject(): Promise<Project> {
    return projectFromSourceFiles({
      read: async (path) => (await this.repository.readSource(path)).content,
    })
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

  private async compileAfterMutation(): Promise<
    { compileOk: true } | { compileOk: false; compileError: string }
  > {
    try {
      await this.refreshRenderer()
      return { compileOk: true }
    } catch (error) {
      return {
        compileOk: false,
        compileError: error instanceof Error ? error.message : '剪辑源码暂时无法编译。',
      }
    }
  }

  async replaceSource(input: DurableSourceReplaceInput) {
    const result = await this.repository.replaceSource(input)
    if (result.changed) this.changedSourcePaths.add(input.path)
    const compilation = result.changed
      ? await this.compileAfterMutation()
      : { compileOk: true as const }
    return { ...result, ...compilation }
  }

  async createSource(path: string, content: string) {
    const result = await this.repository.createSource(path, content)
    this.changedSourcePaths.add(path)
    const compilation = await this.compileAfterMutation()
    return { ...result, ...compilation }
  }

  async removeSource(path: string, expectedContent: string) {
    const result = await this.repository.removeSource(path, expectedContent)
    this.changedSourcePaths.add(path)
    const compilation = await this.compileAfterMutation()
    return { ...result, ...compilation }
  }

  async check(): Promise<TimelineBuildResult> {
    try {
      return { artifact: await this.compileProject(), diagnostics: [] }
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
    await this.refreshRenderer()
    const result = await this.repository.commit(message, this.changedSourcePaths)
    this.changedSourcePaths.clear()
    return result
  }
}
