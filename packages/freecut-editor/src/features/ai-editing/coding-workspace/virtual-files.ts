import {
  VIRTUAL_EDITING_DIRECTORIES,
  VirtualFilesError,
  type VirtualFileChange,
  type VirtualFileEntry,
  type VirtualFileInput,
  type VirtualFileListInput,
  type VirtualFileListResult,
  type VirtualFilePatch,
  type VirtualFilePatchResult,
  type VirtualFileReadResult,
  type VirtualFileSearchInput,
  type VirtualFileSearchMatch,
  type VirtualFileSearchResult,
  type VirtualWorkspaceStatus,
} from './virtual-files-types'
import {
  isWithinVirtualDirectory,
  validateVirtualDirectoryPath,
  validateVirtualFilePath,
  virtualFileKind,
} from './virtual-files-path'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const MAX_CURSOR = 10_000

function assertPagination(cursor = 0, limit = DEFAULT_PAGE_SIZE): void {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > MAX_CURSOR ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    throw new VirtualFilesError(
      'INVALID_PAGINATION',
      `Pagination requires a cursor from 0 to ${MAX_CURSOR} and a limit from 1 to ${MAX_PAGE_SIZE}.`,
    )
  }
}

function paginate<T>(
  items: T[],
  cursor = 0,
  limit = DEFAULT_PAGE_SIZE,
): {
  values: T[]
  nextCursor?: number
} {
  assertPagination(cursor, limit)
  const values = items.slice(cursor, cursor + limit)
  const next = cursor + values.length
  return { values, nextCursor: next < items.length ? next : undefined }
}

function compareFiles(
  baseline: ReadonlyMap<string, string>,
  files: ReadonlyMap<string, string>,
): VirtualFileChange[] {
  const paths = new Set([...baseline.keys(), ...files.keys()])
  return [...paths].sort().flatMap((path): VirtualFileChange[] => {
    const before = baseline.get(path)
    const after = files.get(path)
    if (before === after) return []
    if (before === undefined) return [{ path, status: 'created' }]
    if (after === undefined) return [{ path, status: 'deleted' }]
    return [{ path, status: 'modified' }]
  })
}

function countOccurrences(content: string, text: string): number {
  if (text === '') return 0
  let count = 0
  let offset = 0
  for (;;) {
    const index = content.indexOf(text, offset)
    if (index < 0) return count
    count += 1
    offset = index + text.length
  }
}

function listEntries(
  files: ReadonlyMap<string, string>,
  directoryPath: string,
  recursive: boolean,
): VirtualFileEntry[] {
  const entries = new Map<string, VirtualFileEntry>()
  if (directoryPath === '') {
    for (const directory of VIRTUAL_EDITING_DIRECTORIES) {
      entries.set(directory, { path: directory, type: 'directory', kind: directory })
    }
  }
  for (const [filePath, content] of files) {
    if (!isWithinVirtualDirectory(filePath, directoryPath)) continue
    const relative = directoryPath === '' ? filePath : filePath.slice(directoryPath.length + 1)
    if (relative === '') continue
    const parts = relative.split('/')
    if (!recursive && parts.length > 1) {
      const firstPart = parts[0]
      if (firstPart === undefined) continue
      const childPath = directoryPath === '' ? firstPart : `${directoryPath}/${firstPart}`
      entries.set(childPath, {
        path: childPath,
        type: 'directory',
        kind: virtualFileKind(filePath),
      })
      continue
    }
    if (recursive) {
      for (let index = 1; index < parts.length; index += 1) {
        const nested = parts.slice(0, index).join('/')
        const childPath = directoryPath === '' ? nested : `${directoryPath}/${nested}`
        entries.set(childPath, {
          path: childPath,
          type: 'directory',
          kind: virtualFileKind(filePath),
        })
      }
    }
    entries.set(filePath, {
      path: filePath,
      type: 'file',
      kind: virtualFileKind(filePath),
      size: content.length,
    })
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export class VirtualEditingWorkspace {
  private sourceRevisionValue: number
  private revisionValue = 0
  private baseline: Map<string, string>
  private files: Map<string, string>

  constructor(input: { sourceRevision: number; files: VirtualFileInput[] }) {
    if (!Number.isInteger(input.sourceRevision) || input.sourceRevision < 0) {
      throw new VirtualFilesError(
        'REVISION_CONFLICT',
        'Source revision must be a non-negative integer.',
      )
    }
    this.sourceRevisionValue = input.sourceRevision
    this.files = new Map()
    for (const file of input.files) {
      validateVirtualFilePath(file.path)
      if (this.files.has(file.path)) {
        throw new VirtualFilesError('DUPLICATE_FILE', `Duplicate virtual file: ${file.path}`)
      }
      this.files.set(file.path, file.content)
    }
    this.baseline = new Map(this.files)
  }

  get sourceRevision(): number {
    return this.sourceRevisionValue
  }

  get revision(): number {
    return this.revisionValue
  }

  get dirty(): boolean {
    return this.getChanges().length > 0
  }

  snapshot(): VirtualFileInput[] {
    return [...this.files.entries()]
      .map(([path, content]) => ({ path, content }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  list(input: VirtualFileListInput = {}): VirtualFileListResult {
    const path = validateVirtualDirectoryPath(input.path)
    const entries = listEntries(this.files, path, input.recursive ?? false)
    if (path !== '' && entries.length === 0 && !this.hasDirectory(path)) {
      throw new VirtualFilesError('PATH_NOT_FOUND', `Virtual directory not found: ${path}`)
    }
    const page = paginate(entries, input.cursor, input.limit)
    return { entries: page.values, nextCursor: page.nextCursor }
  }

  read(path: string): VirtualFileReadResult {
    const kind = validateVirtualFilePath(path)
    const content = this.files.get(path)
    if (content === undefined)
      throw new VirtualFilesError('FILE_NOT_FOUND', `Virtual file not found: ${path}`)
    return { path, kind, content, size: content.length, revision: this.revisionValue }
  }

  search(input: VirtualFileSearchInput): VirtualFileSearchResult {
    if (input.query.length === 0)
      throw new VirtualFilesError('INVALID_QUERY', 'Search query cannot be empty.')
    const path = validateVirtualDirectoryPath(input.path)
    const needle = input.caseSensitive ? input.query : input.query.toLocaleLowerCase()
    const matches: VirtualFileSearchMatch[] = []
    const cursor = input.cursor ?? 0
    const limit = input.limit ?? DEFAULT_PAGE_SIZE
    assertPagination(cursor, limit)
    const requiredMatches = cursor + limit + 1
    let complete = false
    for (const [filePath, content] of [...this.files].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (!isWithinVirtualDirectory(filePath, path)) continue
      const lines = content.split('\n')
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]
        if (line === undefined) continue
        const haystack = input.caseSensitive ? line : line.toLocaleLowerCase()
        let offset = 0
        while (offset <= haystack.length) {
          const column = haystack.indexOf(needle, offset)
          if (column < 0) break
          matches.push({ path: filePath, line: lineIndex + 1, column: column + 1, preview: line })
          if (matches.length >= requiredMatches) {
            complete = true
            break
          }
          offset = column + Math.max(needle.length, 1)
        }
        if (complete) break
      }
      if (complete) break
    }
    const values = matches.slice(cursor, cursor + limit)
    return {
      matches: values,
      ...(matches.length > cursor + values.length ? { nextCursor: cursor + values.length } : {}),
    }
  }

  applyPatch(patch: VirtualFilePatch): VirtualFilePatchResult {
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== this.revisionValue) {
      throw new VirtualFilesError(
        'REVISION_CONFLICT',
        `Workspace revision is ${this.revisionValue}, not ${patch.expectedRevision}.`,
      )
    }
    if (patch.operations.length === 0)
      throw new VirtualFilesError('EMPTY_PATCH', 'Patch has no operations.')
    const nextFiles = new Map(this.files)
    for (const operation of patch.operations) {
      validateVirtualFilePath(operation.path)
      const current = nextFiles.get(operation.path)
      if (operation.op === 'write') {
        if (operation.expectedContent !== undefined && current !== operation.expectedContent) {
          throw new VirtualFilesError('CONTENT_CONFLICT', `File content changed: ${operation.path}`)
        }
        nextFiles.set(operation.path, operation.content)
        continue
      }
      if (current === undefined) {
        throw new VirtualFilesError('FILE_NOT_FOUND', `Virtual file not found: ${operation.path}`)
      }
      if (operation.op === 'delete') {
        if (operation.expectedContent !== undefined && current !== operation.expectedContent) {
          throw new VirtualFilesError('CONTENT_CONFLICT', `File content changed: ${operation.path}`)
        }
        nextFiles.delete(operation.path)
        continue
      }
      const occurrences = countOccurrences(current, operation.oldText)
      if (occurrences === 0) {
        throw new VirtualFilesError(
          'REPLACE_TEXT_NOT_FOUND',
          `Replace text not found in ${operation.path}.`,
        )
      }
      if (!operation.replaceAll && occurrences > 1) {
        throw new VirtualFilesError(
          'REPLACE_TEXT_AMBIGUOUS',
          `Replace text occurs ${occurrences} times in ${operation.path}.`,
        )
      }
      nextFiles.set(
        operation.path,
        operation.replaceAll
          ? current.split(operation.oldText).join(operation.newText)
          : current.replace(operation.oldText, operation.newText),
      )
    }
    const changed = compareFiles(this.files, nextFiles).length > 0
    if (changed) {
      this.files = nextFiles
      this.revisionValue += 1
    }
    return { changed, revision: this.revisionValue, changes: this.getChanges() }
  }

  async applyPatchAtomically(
    patch: VirtualFilePatch,
    persist: (result: VirtualFilePatchResult) => Promise<void>,
  ): Promise<VirtualFilePatchResult> {
    const checkpoint = {
      sourceRevision: this.sourceRevisionValue,
      revision: this.revisionValue,
      baseline: new Map(this.baseline),
      files: new Map(this.files),
    }
    const result = this.applyPatch(patch)
    if (!result.changed) return result
    try {
      await persist(result)
      return result
    } catch (error) {
      this.sourceRevisionValue = checkpoint.sourceRevision
      this.revisionValue = checkpoint.revision
      this.baseline = checkpoint.baseline
      this.files = checkpoint.files
      throw error
    }
  }

  status(): VirtualWorkspaceStatus {
    const changes = this.getChanges()
    return {
      sourceRevision: this.sourceRevisionValue,
      revision: this.revisionValue,
      dirty: changes.length > 0,
      changes,
    }
  }

  markClean(sourceRevision = this.sourceRevisionValue): void {
    if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
      throw new VirtualFilesError(
        'REVISION_CONFLICT',
        'Source revision must be a non-negative integer.',
      )
    }
    this.sourceRevisionValue = sourceRevision
    this.baseline = new Map(this.files)
  }

  refreshWritableFile(path: string, content: string | null): void {
    const kind = validateVirtualFilePath(path)
    if (kind === 'media' || kind === 'evidence' || kind === 'docs') {
      throw new VirtualFilesError('INVALID_PATH', `Read-only file cannot be refreshed: ${path}`)
    }
    const current = this.files.get(path)
    if (content === null) {
      if (current === undefined) return
      this.files.delete(path)
    } else {
      if (current === content) return
      this.files.set(path, content)
    }
    this.revisionValue += 1
  }

  refreshReadOnlyProjection(sourceRevision: number, files: readonly VirtualFileInput[]): void {
    if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
      throw new VirtualFilesError(
        'REVISION_CONFLICT',
        'Source revision must be a non-negative integer.',
      )
    }
    const projected = new Map<string, string>()
    for (const file of files) {
      const kind = validateVirtualFilePath(file.path)
      if (kind !== 'media' && kind !== 'evidence' && kind !== 'docs') {
        throw new VirtualFilesError(
          'INVALID_PATH',
          `Read-only projection cannot replace source file: ${file.path}`,
        )
      }
      if (projected.has(file.path)) {
        throw new VirtualFilesError('DUPLICATE_FILE', `Duplicate virtual file: ${file.path}`)
      }
      projected.set(file.path, file.content)
    }

    const isReadOnlyPath = (path: string): boolean =>
      path.startsWith('media/') || path.startsWith('evidence/') || path.startsWith('docs/')
    const nextFiles = new Map([...this.files].filter(([path]) => !isReadOnlyPath(path)))
    const nextBaseline = new Map([...this.baseline].filter(([path]) => !isReadOnlyPath(path)))
    for (const [path, content] of projected) {
      nextFiles.set(path, content)
      nextBaseline.set(path, content)
    }
    if (compareFiles(this.files, nextFiles).length > 0) this.revisionValue += 1
    this.sourceRevisionValue = sourceRevision
    this.files = nextFiles
    this.baseline = nextBaseline
  }

  private getChanges(): VirtualFileChange[] {
    return compareFiles(this.baseline, this.files)
  }

  private hasDirectory(path: string): boolean {
    return (
      VIRTUAL_EDITING_DIRECTORIES.includes(path as (typeof VIRTUAL_EDITING_DIRECTORIES)[number]) ||
      [...this.files.keys()].some((filePath) => filePath.startsWith(`${path}/`))
    )
  }
}

export * from './virtual-files-types'
