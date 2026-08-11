export const VIRTUAL_EDITING_DIRECTORIES = [
  'sequences',
  'segments',
  'components',
  'media',
  'evidence',
  'tests',
] as const

export type VirtualEditingDirectory = (typeof VIRTUAL_EDITING_DIRECTORIES)[number]
export type VirtualFileKind = 'manifest' | VirtualEditingDirectory

export interface VirtualFileInput {
  path: string
  content: string
}

export interface VirtualFileEntry {
  path: string
  type: 'file' | 'directory'
  kind: VirtualFileKind
  size?: number
}

export interface VirtualFileReadResult {
  path: string
  kind: VirtualFileKind
  content: string
  size: number
  revision: number
}

export interface VirtualFileListInput {
  path?: string
  recursive?: boolean
  cursor?: number
  limit?: number
}

export interface VirtualFileListResult {
  entries: VirtualFileEntry[]
  nextCursor?: number
}

export interface VirtualFileSearchInput {
  query: string
  path?: string
  caseSensitive?: boolean
  cursor?: number
  limit?: number
}

export interface VirtualFileSearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

export interface VirtualFileSearchResult {
  matches: VirtualFileSearchMatch[]
  nextCursor?: number
}

export type VirtualFilePatchOperation =
  | {
      op: 'write'
      path: string
      content: string
      expectedContent?: string
    }
  | {
      op: 'replace'
      path: string
      oldText: string
      newText: string
      replaceAll?: boolean
    }
  | {
      op: 'delete'
      path: string
      expectedContent?: string
    }

export interface VirtualFilePatch {
  expectedRevision?: number
  operations: VirtualFilePatchOperation[]
}

export type VirtualFileChangeStatus = 'created' | 'modified' | 'deleted'

export interface VirtualFileChange {
  path: string
  status: VirtualFileChangeStatus
}

export interface VirtualFilePatchResult {
  changed: boolean
  revision: number
  changes: VirtualFileChange[]
}

export interface VirtualWorkspaceStatus {
  sourceRevision: number
  revision: number
  dirty: boolean
  changes: VirtualFileChange[]
}

export type VirtualFilesErrorCode =
  | 'INVALID_PATH'
  | 'FILE_NOT_FOUND'
  | 'PATH_NOT_FOUND'
  | 'FILE_ALREADY_EXISTS'
  | 'DUPLICATE_FILE'
  | 'INVALID_QUERY'
  | 'INVALID_PAGINATION'
  | 'EMPTY_PATCH'
  | 'REVISION_CONFLICT'
  | 'CONTENT_CONFLICT'
  | 'REPLACE_TEXT_NOT_FOUND'
  | 'REPLACE_TEXT_AMBIGUOUS'

export class VirtualFilesError extends Error {
  readonly code: VirtualFilesErrorCode

  constructor(code: VirtualFilesErrorCode, message: string) {
    super(message)
    this.name = 'VirtualFilesError'
    this.code = code
  }
}
