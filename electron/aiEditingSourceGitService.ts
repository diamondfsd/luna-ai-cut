import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import git from 'isomorphic-git'
import type {
  AiEditingSourceBranches,
  AiEditingSourceChange,
  AiEditingSourceCommit,
  AiEditingSourceDiffEntry,
  AiEditingSourceEntry,
  AiEditingSourceGitApi,
  AiEditingSourceInitialFiles,
  AiEditingSourceStatus,
  AiEditingSourceStatusEntry,
} from '../src/shared/types'
import {
  ensurePlainDirectory,
  MAX_CHANGE_BATCH_BYTES,
  sourceContentBytes,
  validateBranchName,
  validateProjectId,
  validateSourcePath,
} from './aiEditingSourceGitPaths.ts'
import { AI_EDITING_GIT_AUTHOR, setupAiEditingSourceRepository } from './aiEditingSourceGitSetup.ts'

const WORKSPACE_DIRECTORY = 'freecut-workspace'
const PROJECTS_DIRECTORY = 'projects'
const SOURCE_DIRECTORY = 'editing-source'
const MAX_INITIAL_SOURCE_FILES = 2_000

function changeFromStatus(head: number, workdir: number): AiEditingSourceStatusEntry['change'] {
  if (head === 0) return 'added'
  if (workdir === 0) return 'deleted'
  return 'modified'
}

export class AiEditingSourceGitService {
  readonly repositoryPath: string
  private readonly baseDirectory: string
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(baseDir: string, projectId: string) {
    validateProjectId(projectId)
    this.baseDirectory = path.resolve(baseDir)
    this.repositoryPath = path.join(
      this.baseDirectory,
      WORKSPACE_DIRECTORY,
      PROJECTS_DIRECTORY,
      projectId,
      SOURCE_DIRECTORY,
    )
  }

  ensureRepository(
    initialFiles: AiEditingSourceInitialFiles = {},
  ): Promise<{ created: boolean; head: string | null }> {
    return this.enqueueMutation(() => this.ensureRepositoryNow(initialFiles))
  }

  private async ensureRepositoryNow(
    initialFiles: AiEditingSourceInitialFiles,
  ): Promise<{ created: boolean; head: string | null }> {
    if (!initialFiles || typeof initialFiles !== 'object' || Array.isArray(initialFiles)) {
      throw new Error('初始源码无效')
    }
    if (Object.keys(initialFiles).length > MAX_INITIAL_SOURCE_FILES) {
      throw new Error('初始源码文件数量超出限制')
    }
    const files = Object.entries(initialFiles).map(([sourcePath, content]) => {
      if (typeof content !== 'string') throw new Error('源码内容无效')
      sourceContentBytes(content)
      return [validateSourcePath(sourcePath), content] as const
    })
    await this.ensureRepositoryDirectory(true)
    return setupAiEditingSourceRepository({
      repositoryPath: this.repositoryPath,
      files,
      resolveWritablePath: (sourcePath, createdDirectories) =>
        this.resolveWritablePath(sourcePath, createdDirectories),
    })
  }

  async status(): Promise<AiEditingSourceStatus> {
    await this.mutationTail
    return this.statusNow()
  }

  private async statusNow(): Promise<AiEditingSourceStatus> {
    await this.requireRepository()
    const rows = await git.statusMatrix({ fs: nodeFs, dir: this.repositoryPath })
    const entries = rows
      .filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
      .map(([sourcePath, head, workdir]) => ({
        path: sourcePath,
        change: changeFromStatus(head, workdir),
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
    const branch = await git.currentBranch({
      fs: nodeFs,
      dir: this.repositoryPath,
      fullname: false,
    })
    return { branch: branch ?? null, clean: entries.length === 0, entries }
  }

  async list(sourceDirectory = ''): Promise<AiEditingSourceEntry[]> {
    await this.mutationTail
    await this.requireRepository()
    const safeDirectory = validateSourcePath(sourceDirectory, true)
    const directory = safeDirectory
      ? await this.resolveExistingPath(safeDirectory, 'directory')
      : this.repositoryPath
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const result: AiEditingSourceEntry[] = []
    for (const entry of entries) {
      if (!safeDirectory && entry.name === '.git') continue
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error('剪辑源码目录包含不支持的文件')
      }
      const relativePath = safeDirectory ? `${safeDirectory}/${entry.name}` : entry.name
      result.push({
        path: relativePath,
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      })
    }
    return result.sort((left, right) => left.path.localeCompare(right.path))
  }

  async read(sourcePath: string): Promise<string> {
    await this.mutationTail
    return this.readNow(sourcePath)
  }

  private async readNow(sourcePath: string): Promise<string> {
    await this.requireRepository()
    return fs.readFile(
      await this.resolveExistingPath(validateSourcePath(sourcePath), 'file'),
      'utf8',
    )
  }

  async write(sourcePath: string, content: string): Promise<void> {
    await this.applyChanges([{ path: sourcePath, content }])
  }

  async remove(sourcePath: string): Promise<void> {
    await this.applyChanges([{ path: sourcePath, content: null }])
  }

  async applyChanges(changes: AiEditingSourceChange[]): Promise<void> {
    return this.enqueueMutation(() => this.applyChangesTransaction(changes))
  }

  private async applyChangesTransaction(changes: AiEditingSourceChange[]): Promise<void> {
    await this.requireRepository()
    if (!Array.isArray(changes) || changes.length === 0 || changes.length > 500) {
      throw new Error('源码改动批次无效')
    }
    let batchBytes = 0
    const normalized = changes.map((change) => {
      if (
        !change ||
        typeof change !== 'object' ||
        (change.content !== null && typeof change.content !== 'string')
      ) {
        throw new Error('源码改动无效')
      }
      if (change.content !== null) batchBytes += sourceContentBytes(change.content)
      return { path: validateSourcePath(change.path), content: change.content }
    })
    if (batchBytes > MAX_CHANGE_BATCH_BYTES) throw new Error('源码改动批次超出大小限制')
    if (new Set(normalized.map((change) => change.path)).size !== normalized.length) {
      throw new Error('源码改动路径重复')
    }

    const transactionDirectory = path.join(this.repositoryPath, '.git', 'luna-editing-transactions')
    await ensurePlainDirectory(transactionDirectory, true)
    const transactionRoot = path.join(transactionDirectory, randomUUID())
    const snapshots: Array<{ target: string; backup: string; existed: boolean }> = []
    const createdDirectories = new Set<string>()
    let appliedCount = 0
    let preserveTransaction = false
    try {
      await fs.mkdir(transactionRoot)
      for (const [index, change] of normalized.entries()) {
        const target = await this.inspectBatchTarget(change.path)
        let existed = false
        try {
          const stat = await fs.lstat(target)
          if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('剪辑源码路径类型无效')
          existed = true
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (change.content === null && !existed) throw new Error('要删除的剪辑源码不存在')
        const backup = path.join(transactionRoot, `${index}.backup`)
        if (existed) await fs.copyFile(target, backup)
        if (change.content !== null) {
          await fs.writeFile(path.join(transactionRoot, `${index}.next`), change.content, {
            encoding: 'utf8',
            mode: 0o600,
          })
        }
        snapshots.push({ target, backup, existed })
      }

      for (const [index, change] of normalized.entries()) {
        const snapshot = snapshots[index]!
        if (change.content === null) {
          await fs.rm(snapshot.target)
        } else {
          const destination = await this.resolveWritablePath(change.path, createdDirectories)
          await fs.rename(path.join(transactionRoot, `${index}.next`), destination)
        }
        appliedCount += 1
      }
    } catch (error) {
      let rollbackFailed = false
      for (const snapshot of snapshots.slice(0, appliedCount).reverse()) {
        try {
          if (snapshot.existed) {
            await fs.mkdir(path.dirname(snapshot.target), { recursive: true })
            await fs.copyFile(snapshot.backup, snapshot.target)
          } else {
            await fs.rm(snapshot.target, { force: true })
          }
        } catch {
          rollbackFailed = true
        }
      }
      for (const directory of [...createdDirectories].sort(
        (left, right) => right.length - left.length,
      )) {
        await fs.rmdir(directory).catch(() => undefined)
      }
      if (rollbackFailed) {
        preserveTransaction = true
        throw new Error('源码改动失败且无法完整恢复', { cause: error })
      }
      throw error
    } finally {
      if (!preserveTransaction) {
        await fs.rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  async diff(): Promise<AiEditingSourceDiffEntry[]> {
    await this.mutationTail
    const sourceStatus = await this.statusNow()
    const head = await this.tryResolveHead()
    return Promise.all(
      sourceStatus.entries.map(async (entry) => ({
        ...entry,
        before: head && entry.change !== 'added' ? await this.readHeadFile(head, entry.path) : null,
        after: entry.change === 'deleted' ? null : await this.readNow(entry.path),
      })),
    )
  }

  async log(limit = 20): Promise<AiEditingSourceCommit[]> {
    await this.mutationTail
    await this.requireRepository()
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('提交记录数量无效')
    const commits = await git.log({ fs: nodeFs, dir: this.repositoryPath, depth: limit })
    return commits.map(({ oid, commit }) => ({
      oid,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp: commit.author.timestamp,
      },
    }))
  }

  async branches(): Promise<AiEditingSourceBranches> {
    await this.mutationTail
    await this.requireRepository()
    const [names, current] = await Promise.all([
      git.listBranches({ fs: nodeFs, dir: this.repositoryPath }),
      git.currentBranch({ fs: nodeFs, dir: this.repositoryPath, fullname: false }),
    ])
    return {
      current: current ?? null,
      names: names.sort((left, right) => left.localeCompare(right)),
    }
  }

  createBranch(name: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.requireRepository()
      validateBranchName(name)
      await git.branch({ fs: nodeFs, dir: this.repositoryPath, ref: name })
    })
  }

  checkout(name: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.requireRepository()
      validateBranchName(name)
      const sourceStatus = await this.statusNow()
      if (!sourceStatus.clean) throw new Error('请先提交或撤销当前剪辑源码改动')
      const available = await git.listBranches({ fs: nodeFs, dir: this.repositoryPath })
      if (!available.includes(name)) throw new Error('剪辑源码分支不存在')
      await git.checkout({ fs: nodeFs, dir: this.repositoryPath, ref: name })
    })
  }

  commit(message: string): Promise<string> {
    return this.enqueueMutation(async () => {
      await this.requireRepository()
      const trimmedMessage = typeof message === 'string' ? message.trim() : ''
      if (!trimmedMessage || trimmedMessage.length > 500) throw new Error('提交说明无效')
      const sourceStatus = await this.statusNow()
      if (sourceStatus.clean) throw new Error('没有需要提交的剪辑源码改动')
      await this.stageAll()
      return git.commit({
        fs: nodeFs,
        dir: this.repositoryPath,
        message: trimmedMessage,
        author: AI_EDITING_GIT_AUTHOR,
        disallowEmpty: true,
      })
    })
  }

  private async ensureRepositoryDirectory(create: boolean): Promise<void> {
    if (create) await fs.mkdir(this.baseDirectory, { recursive: true })
    await ensurePlainDirectory(this.baseDirectory, false)
    let current = this.baseDirectory
    for (const segment of [
      WORKSPACE_DIRECTORY,
      PROJECTS_DIRECTORY,
      path.basename(path.dirname(this.repositoryPath)),
      SOURCE_DIRECTORY,
    ]) {
      current = path.join(current, segment)
      await ensurePlainDirectory(current, create)
    }
    const realBase = await fs.realpath(this.baseDirectory)
    const realRepository = await fs.realpath(this.repositoryPath)
    const relative = path.relative(realBase, realRepository)
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('剪辑源码目录无效')
    }
  }

  private async requireRepository(): Promise<void> {
    await this.ensureRepositoryDirectory(false)
    const stat = await fs.lstat(path.join(this.repositoryPath, '.git'))
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('剪辑源码仓库无效')
  }

  private async resolveExistingPath(
    sourcePath: string,
    expected: 'file' | 'directory',
  ): Promise<string> {
    const target = path.join(this.repositoryPath, ...sourcePath.split('/'))
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || (expected === 'file' ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('剪辑源码路径类型无效')
    }
    const realRepository = await fs.realpath(this.repositoryPath)
    const realTarget = await fs.realpath(target)
    if (!realTarget.startsWith(`${realRepository}${path.sep}`))
      throw new Error('源码路径不属于当前项目')
    return realTarget
  }

  private async inspectBatchTarget(sourcePath: string): Promise<string> {
    const segments = sourcePath.split('/')
    let current = this.repositoryPath
    for (const segment of segments.slice(0, -1)) {
      current = path.join(current, segment)
      try {
        const stat = await fs.lstat(current)
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('剪辑源码目录无效')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
        throw error
      }
    }
    return path.join(this.repositoryPath, ...segments)
  }

  private async resolveWritablePath(
    sourcePath: string,
    createdDirectories?: Set<string>,
  ): Promise<string> {
    const segments = sourcePath.split('/')
    let parent = this.repositoryPath
    for (const segment of segments.slice(0, -1)) {
      parent = path.join(parent, segment)
      try {
        await fs.lstat(parent)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') createdDirectories?.add(parent)
        else throw error
      }
      await ensurePlainDirectory(parent, true)
    }
    const target = path.join(parent, segments.at(-1)!)
    try {
      const stat = await fs.lstat(target)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('剪辑源码路径类型无效')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return target
  }

  private async stageAll(): Promise<void> {
    const rows = await git.statusMatrix({ fs: nodeFs, dir: this.repositoryPath })
    for (const [sourcePath, head, workdir, stage] of rows) {
      if (head === stage && workdir === stage) continue
      if (workdir === 0)
        await git.remove({ fs: nodeFs, dir: this.repositoryPath, filepath: sourcePath })
      else await git.add({ fs: nodeFs, dir: this.repositoryPath, filepath: sourcePath })
    }
  }

  private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation)
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async tryResolveHead(): Promise<string | null> {
    try {
      return await git.resolveRef({ fs: nodeFs, dir: this.repositoryPath, ref: 'HEAD' })
    } catch {
      return null
    }
  }

  private async readHeadFile(head: string, sourcePath: string): Promise<string> {
    const { blob } = await git.readBlob({
      fs: nodeFs,
      dir: this.repositoryPath,
      oid: head,
      filepath: sourcePath,
    })
    return Buffer.from(blob).toString('utf8')
  }
}

export function createAiEditingSourceGitService(
  baseDir: string,
  projectId: string,
): AiEditingSourceGitService {
  return new AiEditingSourceGitService(baseDir, projectId)
}

export function createAiEditingSourceGitApi(baseDir: string): AiEditingSourceGitApi {
  const services = new Map<string, AiEditingSourceGitService>()
  const serviceFor = (projectId: string): AiEditingSourceGitService => {
    let service = services.get(projectId)
    if (!service) {
      service = createAiEditingSourceGitService(baseDir, projectId)
      services.set(projectId, service)
    }
    return service
  }
  return {
    ensure: async (projectId, initialFiles) => serviceFor(projectId).ensureRepository(initialFiles),
    status: async (projectId) => serviceFor(projectId).status(),
    list: async (projectId, sourceDirectory) => serviceFor(projectId).list(sourceDirectory),
    read: async (projectId, sourcePath) => serviceFor(projectId).read(sourcePath),
    write: async (projectId, sourcePath, content) =>
      serviceFor(projectId).write(sourcePath, content),
    remove: async (projectId, sourcePath) => serviceFor(projectId).remove(sourcePath),
    applyChanges: async (projectId, changes) => serviceFor(projectId).applyChanges(changes),
    diff: async (projectId) => serviceFor(projectId).diff(),
    log: async (projectId, limit) => serviceFor(projectId).log(limit),
    branches: async (projectId) => serviceFor(projectId).branches(),
    createBranch: async (projectId, name) => serviceFor(projectId).createBranch(name),
    checkout: async (projectId, name) => serviceFor(projectId).checkout(name),
    commit: async (projectId, message) => serviceFor(projectId).commit(message),
  }
}
