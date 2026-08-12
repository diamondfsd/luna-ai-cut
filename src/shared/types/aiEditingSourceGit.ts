export type AiEditingSourceInitialFiles = Record<string, string>

export interface AiEditingSourceStatusEntry {
  path: string
  change: 'added' | 'modified' | 'deleted'
}

export interface AiEditingSourceStatus {
  branch: string | null
  clean: boolean
  entries: AiEditingSourceStatusEntry[]
}

export interface AiEditingSourceEntry {
  path: string
  name: string
  type: 'file' | 'directory'
}

export interface AiEditingSourceDiffEntry extends AiEditingSourceStatusEntry {
  before: string | null
  after: string | null
}

export interface AiEditingSourceCommit {
  oid: string
  message: string
  author: { name: string; email: string; timestamp: number }
}

export interface AiEditingSourceBranches {
  current: string | null
  names: string[]
}

export interface AiEditingSourceChange {
  path: string
  /** `null` removes an existing source file. */
  content: string | null
  /** Omit for an unconditional write, `null` to require absence, or text to require exact content. */
  expectedContent?: string | null
  /** SHA-256 of the expected current content. Prefer this for model-driven edits. */
  expectedRevision?: string
}

export interface AiEditingSourceReplaceInput {
  path: string
  oldText: string
  newText: string
  replaceAll?: boolean
}

export interface AiEditingSourceReplaceResult {
  changed: boolean
  content: string
  replacements: number
}

export interface AiEditingSourceGitApi {
  ensure(
    projectId: string,
    initialFiles?: AiEditingSourceInitialFiles,
  ): Promise<{ created: boolean; head: string | null }>
  status(projectId: string): Promise<AiEditingSourceStatus>
  list(projectId: string, sourceDirectory?: string): Promise<AiEditingSourceEntry[]>
  read(projectId: string, sourcePath: string): Promise<string>
  create(projectId: string, sourcePath: string, content: string): Promise<void>
  replace(
    projectId: string,
    input: AiEditingSourceReplaceInput,
  ): Promise<AiEditingSourceReplaceResult>
  write(projectId: string, sourcePath: string, content: string): Promise<void>
  remove(projectId: string, sourcePath: string, expectedRevision?: string): Promise<void>
  applyChanges(projectId: string, changes: AiEditingSourceChange[]): Promise<void>
  diff(projectId: string): Promise<AiEditingSourceDiffEntry[]>
  log(projectId: string, limit?: number): Promise<AiEditingSourceCommit[]>
  branches(projectId: string): Promise<AiEditingSourceBranches>
  createBranch(projectId: string, name: string): Promise<void>
  checkout(projectId: string, name: string): Promise<void>
  commit(projectId: string, message: string, sourcePaths?: string[]): Promise<string>
}
