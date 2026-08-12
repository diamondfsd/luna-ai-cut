import type { EmbeddedAiEditingSourceGitBridge } from '@freecut/shared/host/embedded-host'
import {
  VirtualEditingWorkspace,
  VirtualFilesError,
  type VirtualFileInput,
  type VirtualFilePatch,
  type VirtualFilePatchResult,
} from './virtual-files'

const SOURCE_FILE_PATTERN = /^(manifest\.json|(?:sequences|components)\/.+\.json)$/
const MAX_SOURCE_FILES = 2_000

export function isEditingSourceFile(path: string): boolean {
  return SOURCE_FILE_PATTERN.test(path)
}

function initialSourceFiles(files: readonly VirtualFileInput[]): Record<string, string> {
  return Object.fromEntries(
    files.filter((file) => isEditingSourceFile(file.path)).map((file) => [file.path, file.content]),
  )
}

async function readSourceFiles(
  bridge: EmbeddedAiEditingSourceGitBridge,
  projectId: string,
): Promise<VirtualFileInput[]> {
  const files: VirtualFileInput[] = []
  const pending = ['']
  while (pending.length > 0) {
    const directory = pending.shift()!
    const entries = await bridge.list(projectId, directory)
    for (const entry of entries) {
      if (entry.type === 'directory') {
        pending.push(entry.path)
        continue
      }
      if (!isEditingSourceFile(entry.path)) {
        throw new Error(`剪辑源码仓库包含不支持的文件：${entry.path}`)
      }
      files.push({ path: entry.path, content: await bridge.read(projectId, entry.path) })
      if (files.length > MAX_SOURCE_FILES) throw new Error('剪辑源码文件数量超出限制。')
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function readOptional(workspace: VirtualEditingWorkspace, path: string): string | undefined {
  try {
    return workspace.read(path).content
  } catch (error) {
    if (error instanceof VirtualFilesError && error.code === 'FILE_NOT_FOUND') return undefined
    throw error
  }
}

export interface DurableSourceStatus {
  branch: string | null
  headCommitId: string | null
  clean: boolean
  entries: Array<{ path: string; change: 'added' | 'modified' | 'deleted' }>
}

export interface DurableSourceReplaceInput {
  path: string
  oldText: string
  newText: string
  replaceAll?: boolean
}

export interface DurableSourceChange {
  path: string
  content: string | null
  expectedRevision: string | null
}

export class DurableEditingSourceRepository {
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    readonly projectId: string,
    readonly workspace: VirtualEditingWorkspace,
    private readonly bridge: EmbeddedAiEditingSourceGitBridge,
  ) {}

  static async open(input: {
    projectId: string
    sourceRevision: number
    projectedFiles: readonly VirtualFileInput[]
    bridge: EmbeddedAiEditingSourceGitBridge
  }): Promise<DurableEditingSourceRepository> {
    await input.bridge.ensure(input.projectId, initialSourceFiles(input.projectedFiles))
    const persistedSource = await readSourceFiles(input.bridge, input.projectId)
    const readOnlyProjection = input.projectedFiles.filter(
      (file) => !isEditingSourceFile(file.path),
    )
    const workspace = new VirtualEditingWorkspace({
      sourceRevision: input.sourceRevision,
      files: [...readOnlyProjection, ...persistedSource],
    })
    return new DurableEditingSourceRepository(input.projectId, workspace, input.bridge)
  }

  async applyPatch(patch: VirtualFilePatch): Promise<VirtualFilePatchResult> {
    return this.enqueueMutation(async () => {
      const paths = [...new Set(patch.operations.map((operation) => operation.path))]
      if (paths.some((path) => !isEditingSourceFile(path))) {
        throw new Error('只能修改剪辑源码文件。')
      }
      const before = new Map(paths.map((path) => [path, readOptional(this.workspace, path)]))
      return this.workspace.applyPatchAtomically(patch, async () => {
        const changes = paths.flatMap((path) => {
          const previous = before.get(path)
          const content = readOptional(this.workspace, path)
          return previous === content ? [] : [{ path, content: content ?? null }]
        })
        await this.bridge.applyChanges(this.projectId, changes)
      })
    })
  }

  async readSource(path: string): Promise<{ path: string; content: string; size: number }> {
    if (!isEditingSourceFile(path)) throw new Error('只能读取剪辑源码文件。')
    await this.mutationTail
    const content = await this.bridge.read(this.projectId, path)
    this.workspace.refreshWritableFile(path, content)
    return { path, content, size: content.length }
  }

  replaceSource(input: DurableSourceReplaceInput) {
    if (!isEditingSourceFile(input.path)) throw new Error('只能修改剪辑源码文件。')
    return this.enqueueMutation(async () => {
      const result = await this.bridge.replace(this.projectId, input)
      this.workspace.refreshWritableFile(input.path, result.content)
      return { path: input.path, ...result }
    })
  }

  createSource(path: string, content: string) {
    if (!isEditingSourceFile(path)) throw new Error('只能创建剪辑源码文件。')
    return this.enqueueMutation(async () => {
      await this.bridge.create(this.projectId, path, content)
      this.workspace.refreshWritableFile(path, content)
      return { path, size: content.length }
    })
  }

  removeSource(path: string, expectedRevision: string) {
    if (!isEditingSourceFile(path)) throw new Error('只能删除剪辑源码文件。')
    return this.enqueueMutation(async () => {
      await this.bridge.remove(this.projectId, path, expectedRevision)
      this.workspace.refreshWritableFile(path, null)
      return { path, removed: true }
    })
  }

  applySourceChanges(changes: DurableSourceChange[]) {
    if (changes.some((change) => !isEditingSourceFile(change.path))) {
      throw new Error('只能修改剪辑源码文件。')
    }
    return this.enqueueMutation(async () => {
      await this.bridge.applyChanges(this.projectId, changes.map((change) => ({
        path: change.path,
        content: change.content,
        ...(change.expectedRevision === null
          ? { expectedContent: null }
          : { expectedRevision: change.expectedRevision }),
      })))
      for (const change of changes) this.workspace.refreshWritableFile(change.path, change.content)
      return {
        changed: changes.length > 0,
        changes: changes.map((change) => ({
          path: change.path,
          operation: change.content === null ? 'removed' as const : 'written' as const,
        })),
      }
    })
  }

  async status(): Promise<DurableSourceStatus> {
    await this.mutationTail
    return this.readStatus()
  }

  refreshProjection(sourceRevision: number, files: readonly VirtualFileInput[]): void {
    this.workspace.refreshReadOnlyProjection(
      sourceRevision,
      files.filter((file) => !isEditingSourceFile(file.path)),
    )
  }

  runAtCleanHead<T>(commitId: string, operation: () => Promise<T>): Promise<T> {
    return this.enqueueMutation(async () => {
      const status = await this.readStatus()
      if (!status.clean || status.headCommitId !== commitId) {
        throw new Error('请先提交当前剪辑源码，再发布对应版本。')
      }
      return operation()
    })
  }

  private async readStatus(): Promise<DurableSourceStatus> {
    const [status, log] = await Promise.all([
      this.bridge.status(this.projectId),
      this.bridge.log(this.projectId, 1),
    ])
    return {
      branch: status.branch,
      headCommitId: log[0]?.oid ?? null,
      clean: status.clean,
      entries: status.entries,
    }
  }

  async diff() {
    await this.mutationTail
    return this.bridge.diff(this.projectId)
  }

  async log(limit?: number) {
    await this.mutationTail
    return this.bridge.log(this.projectId, limit)
  }

  async branches() {
    await this.mutationTail
    return this.bridge.branches(this.projectId)
  }

  createBranch(name: string) {
    return this.enqueueMutation(() => this.bridge.createBranch(this.projectId, name))
  }

  commit(message: string, sourcePaths?: readonly string[]): Promise<{ commitId: string; created: true }> {
    return this.enqueueMutation(async () => {
      const commitId = await this.bridge.commit(
        this.projectId,
        message,
        sourcePaths ? [...sourcePaths] : undefined,
      )
      const status = await this.readStatus()
      if (!status.clean || status.headCommitId !== commitId) {
        throw new Error('剪辑源码提交后仍有未保存的文件，请重新检查工程状态。')
      }
      this.workspace.markClean()
      return { commitId, created: true }
    })
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationTail.then(operation, operation)
    this.mutationTail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }
}
