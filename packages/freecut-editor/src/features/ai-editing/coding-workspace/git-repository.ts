import {
  VirtualEditingWorkspace,
  type VirtualFileChange,
  type VirtualFileInput,
  type VirtualFilePatchOperation,
} from './virtual-files'

const DEFAULT_BRANCH = 'main'
const DEFAULT_LOG_LIMIT = 50
const MAX_LOG_LIMIT = 200

export type EditingSourceRepositoryErrorCode =
  | 'INVALID_BRANCH'
  | 'BRANCH_EXISTS'
  | 'BRANCH_NOT_FOUND'
  | 'COMMIT_NOT_FOUND'
  | 'DIRTY_WORKTREE'
  | 'INVALID_LOG_LIMIT'

export class EditingSourceRepositoryError extends Error {
  constructor(
    readonly code: EditingSourceRepositoryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EditingSourceRepositoryError'
  }
}

export interface EditingSourceCommit {
  id: string
  parentId: string | null
  branch: string
  message: string
  createdAt: number
  sourceRevision: number
  files: readonly VirtualFileInput[]
}

export interface EditingSourceBranch {
  name: string
  commitId: string
  current: boolean
}

export interface EditingSourceFileDiff extends VirtualFileChange {
  before?: string
  after?: string
}

export interface EditingSourceDiff {
  from: string
  to: string
  changes: EditingSourceFileDiff[]
}

export interface EditingSourceStatus {
  branch: string
  headCommitId: string
  sourceRevision: number
  workspaceRevision: number
  dirty: boolean
  changes: VirtualFileChange[]
}

export interface EditingSourceCommitResult {
  commit: EditingSourceCommit
  created: boolean
}

interface StoredCommit extends Omit<EditingSourceCommit, 'files'> {
  files: VirtualFileInput[]
}

function validateBranchName(name: string): void {
  const valid =
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
    !name.includes('..') &&
    !name.includes('//') &&
    !name.endsWith('/') &&
    !name.endsWith('.')
  if (!valid) {
    throw new EditingSourceRepositoryError('INVALID_BRANCH', `Invalid branch name: ${name}`)
  }
}

function cloneFiles(files: readonly VirtualFileInput[]): VirtualFileInput[] {
  return files.map((file) => ({ ...file }))
}

function fileMap(files: readonly VirtualFileInput[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, file.content]))
}

function compareSnapshots(
  beforeFiles: readonly VirtualFileInput[],
  afterFiles: readonly VirtualFileInput[],
): EditingSourceFileDiff[] {
  const before = fileMap(beforeFiles)
  const after = fileMap(afterFiles)
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].sort().flatMap((path): EditingSourceFileDiff[] => {
    const previous = before.get(path)
    const next = after.get(path)
    if (previous === next) return []
    if (previous === undefined) return [{ path, status: 'created', after: next }]
    if (next === undefined) return [{ path, status: 'deleted', before: previous }]
    return [{ path, status: 'modified', before: previous, after: next }]
  })
}

function snapshotWorkspace(workspace: VirtualEditingWorkspace): VirtualFileInput[] {
  const files: VirtualFileInput[] = []
  let cursor: number | undefined
  do {
    const page = workspace.list({ recursive: true, cursor, limit: 200 })
    for (const entry of page.entries) {
      if (entry.type !== 'file') continue
      files.push({ path: entry.path, content: workspace.read(entry.path).content })
    }
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

async function contentCommitId(
  parentId: string | null,
  branch: string,
  files: readonly VirtualFileInput[],
): Promise<string> {
  const parts = [`branch:${branch.length}:${branch}parent:${parentId ?? ''}\n`]
  for (const file of files) {
    parts.push(`${file.path.length}:${file.path}${file.content.length}:${file.content}`)
  }
  const bytes = new TextEncoder().encode(parts.join(''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `edit-${hash}`
}

/**
 * An embedded Git worktree model for internal editing source files. It deliberately does not invoke
 * system Git and never publishes a snapshot to the production timeline.
 */
export class EmbeddedEditingSourceRepository {
  private readonly commits = new Map<string, StoredCommit>()
  private readonly branches = new Map<string, string>()
  private currentBranchValue: string

  private constructor(
    readonly workspace: VirtualEditingWorkspace,
    initialCommit: StoredCommit,
    defaultBranch: string,
  ) {
    this.commits.set(initialCommit.id, initialCommit)
    this.branches.set(defaultBranch, initialCommit.id)
    this.currentBranchValue = defaultBranch
  }

  static async create(input: {
    workspace: VirtualEditingWorkspace
    defaultBranch?: string
    now?: () => number
  }): Promise<EmbeddedEditingSourceRepository> {
    const branch = input.defaultBranch ?? DEFAULT_BRANCH
    validateBranchName(branch)
    const files = snapshotWorkspace(input.workspace)
    const id = await contentCommitId(null, branch, files)
    const initialCommit: StoredCommit = {
      id,
      parentId: null,
      branch,
      message: 'Initial editing source checkout',
      createdAt: (input.now ?? Date.now)(),
      sourceRevision: input.workspace.sourceRevision,
      files,
    }
    return new EmbeddedEditingSourceRepository(input.workspace, initialCommit, branch)
  }

  get currentBranch(): string {
    return this.currentBranchValue
  }

  status(): EditingSourceStatus {
    const head = this.head()
    const changes = compareSnapshots(head.files, snapshotWorkspace(this.workspace)).map(
      ({ path, status }) => ({ path, status }),
    )
    return {
      branch: this.currentBranchValue,
      headCommitId: head.id,
      sourceRevision: this.workspace.sourceRevision,
      workspaceRevision: this.workspace.revision,
      dirty: changes.length > 0,
      changes,
    }
  }

  diff(input: { from?: string; to?: string | 'WORKTREE' } = {}): EditingSourceDiff {
    const from = input.from ? this.resolveCommit(input.from) : this.head()
    const to =
      input.to === undefined || input.to === 'WORKTREE'
        ? { id: 'WORKTREE', files: snapshotWorkspace(this.workspace) }
        : this.resolveCommit(input.to)
    return {
      from: from.id,
      to: to.id,
      changes: compareSnapshots(from.files, to.files),
    }
  }

  async commit(input: { message: string; now?: () => number }): Promise<EditingSourceCommitResult> {
    const parent = this.head()
    const files = snapshotWorkspace(this.workspace)
    if (compareSnapshots(parent.files, files).length === 0) {
      return { commit: this.publicCommit(parent), created: false }
    }
    const id = await contentCommitId(parent.id, this.currentBranchValue, files)
    const existing = this.commits.get(id)
    if (existing) {
      this.branches.set(this.currentBranchValue, existing.id)
      return { commit: this.publicCommit(existing), created: false }
    }
    const commit: StoredCommit = {
      id,
      parentId: parent.id,
      branch: this.currentBranchValue,
      message: input.message,
      createdAt: (input.now ?? Date.now)(),
      sourceRevision: this.workspace.sourceRevision,
      files,
    }
    this.commits.set(id, commit)
    this.branches.set(this.currentBranchValue, id)
    return { commit: this.publicCommit(commit), created: true }
  }

  log(input: { branch?: string; limit?: number } = {}): EditingSourceCommit[] {
    const limit = input.limit ?? DEFAULT_LOG_LIMIT
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOG_LIMIT) {
      throw new EditingSourceRepositoryError(
        'INVALID_LOG_LIMIT',
        `Log limit must be between 1 and ${MAX_LOG_LIMIT}.`,
      )
    }
    let commit: StoredCommit | undefined = input.branch
      ? this.resolveCommit(input.branch)
      : this.head()
    const result: EditingSourceCommit[] = []
    while (commit && result.length < limit) {
      result.push(this.publicCommit(commit))
      commit = commit.parentId ? this.commits.get(commit.parentId) : undefined
    }
    return result
  }

  branch(name: string, startPoint?: string): EditingSourceBranch {
    validateBranchName(name)
    if (this.branches.has(name)) {
      throw new EditingSourceRepositoryError('BRANCH_EXISTS', `Branch already exists: ${name}`)
    }
    const commit = startPoint ? this.resolveCommit(startPoint) : this.head()
    this.branches.set(name, commit.id)
    return { name, commitId: commit.id, current: false }
  }

  branchesList(): EditingSourceBranch[] {
    return [...this.branches]
      .map(([name, commitId]) => ({
        name,
        commitId,
        current: name === this.currentBranchValue,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  checkout(branch: string, input: { force?: boolean } = {}): EditingSourceStatus {
    const commitId = this.branches.get(branch)
    if (!commitId) {
      throw new EditingSourceRepositoryError('BRANCH_NOT_FOUND', `Branch not found: ${branch}`)
    }
    this.assertCleanOrForced(input.force)
    const commit = this.requireCommit(commitId)
    this.restore(commit.files)
    this.currentBranchValue = branch
    return this.status()
  }

  resetToCommit(commitId: string, input: { force?: boolean } = {}): EditingSourceStatus {
    this.assertCleanOrForced(input.force)
    const commit = this.requireCommit(commitId)
    this.restore(commit.files)
    this.branches.set(this.currentBranchValue, commit.id)
    return this.status()
  }

  private head(): StoredCommit {
    return this.requireCommit(this.branches.get(this.currentBranchValue)!)
  }

  private resolveCommit(ref: string): StoredCommit {
    const branchCommit = this.branches.get(ref)
    if (branchCommit) return this.requireCommit(branchCommit)
    return this.requireCommit(ref)
  }

  private requireCommit(id: string): StoredCommit {
    const commit = this.commits.get(id)
    if (!commit) {
      throw new EditingSourceRepositoryError('COMMIT_NOT_FOUND', `Commit not found: ${id}`)
    }
    return commit
  }

  private assertCleanOrForced(force = false): void {
    if (!force && this.status().dirty) {
      throw new EditingSourceRepositoryError(
        'DIRTY_WORKTREE',
        'Editing source worktree has uncommitted changes.',
      )
    }
  }

  private restore(files: readonly VirtualFileInput[]): void {
    const current = snapshotWorkspace(this.workspace)
    const target = fileMap(files)
    const operations: VirtualFilePatchOperation[] = current.flatMap((file) =>
      target.has(file.path)
        ? []
        : [{ op: 'delete' as const, path: file.path, expectedContent: file.content }],
    )
    for (const file of files) {
      const currentContent = current.find((candidate) => candidate.path === file.path)?.content
      if (currentContent === file.content) continue
      operations.push({
        op: 'write',
        path: file.path,
        content: file.content,
        ...(currentContent !== undefined ? { expectedContent: currentContent } : {}),
      })
    }
    if (operations.length > 0) {
      this.workspace.applyPatch({ expectedRevision: this.workspace.revision, operations })
    }
  }

  private publicCommit(commit: StoredCommit): EditingSourceCommit {
    return { ...commit, files: cloneFiles(commit.files) }
  }
}
