/**
 * File System Access compatible handles backed by Electron's native filesystem
 * bridge. Electron cannot create a FileSystemDirectoryHandle from an arbitrary
 * path, so the renderer exposes the same small handle surface used by
 * workspace-fs while the main process owns all path-based file operations.
 */

interface NativeWorkspaceEntry {
  name: string
  kind: 'file' | 'directory'
}

interface NativeWorkspaceApi {
  ensureRoot(): Promise<{ name: string; path: string }>
  getEntry(path: string[], kind: 'file' | 'directory', create: boolean): Promise<boolean>
  list(path: string[]): Promise<NativeWorkspaceEntry[] | null>
  readFile(path: string[]): Promise<ArrayBuffer | null>
  openWriter(path: string[]): Promise<string>
  writeWriter(writerId: string, data: ArrayBuffer): Promise<void>
  closeWriter(writerId: string): Promise<void>
  abortWriter(writerId: string): Promise<void>
  removeEntry(path: string[], recursive: boolean): Promise<void>
  moveFile(sourcePath: string[], destinationPath: string[]): Promise<void>
}

interface NativeWorkspaceWindow extends Window {
  luna?: {
    freecutWorkspace?: NativeWorkspaceApi
  }
}

interface NativeHandleInternals {
  __freecutWorkspacePath: string[]
}

function notFound(message: string): DOMException {
  return new DOMException(message, 'NotFoundError')
}

function invalidName(name: string): void {
  if (
    !name
    || name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')
  ) {
    throw new TypeError('Invalid workspace entry name')
  }
}

function pathOf(handle: FileSystemDirectoryHandle | FileSystemFileHandle): string[] {
  const internals = handle as unknown as Partial<NativeHandleInternals>
  if (!internals.__freecutWorkspacePath) throw new TypeError('Not a native workspace handle')
  return internals.__freecutWorkspacePath
}

async function chunkToArrayBuffer(chunk: unknown): Promise<ArrayBuffer> {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk).buffer
  if (chunk instanceof Blob) return chunk.arrayBuffer()
  if (chunk instanceof ArrayBuffer) return chunk
  if (ArrayBuffer.isView(chunk)) {
    return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer
  }
  if (chunk && typeof chunk === 'object' && 'data' in chunk) {
    return chunkToArrayBuffer((chunk as { data: unknown }).data)
  }
  throw new TypeError('Unsupported workspace write data')
}

class NativeFileHandle implements FileSystemFileHandle, NativeHandleInternals {
  readonly kind = 'file' as const
  readonly __freecutWorkspacePath: string[]

  constructor(
    private readonly api: NativeWorkspaceApi,
    segments: string[],
  ) {
    this.__freecutWorkspacePath = [...segments]
  }

  get name(): string {
    return this.__freecutWorkspacePath.at(-1) ?? ''
  }

  async getFile(): Promise<File> {
    const data = await this.api.readFile(this.__freecutWorkspacePath)
    if (!data) throw notFound(`File not found: ${this.name}`)
    return new File([data], this.name)
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const writerId = await this.api.openWriter(this.__freecutWorkspacePath)
    let closed = false
    const writable = {
      write: async (chunk: unknown) => {
        if (closed) throw new DOMException('Writable stream is closed', 'InvalidStateError')
        await this.api.writeWriter(writerId, await chunkToArrayBuffer(chunk))
      },
      close: async () => {
        if (closed) return
        closed = true
        await this.api.closeWriter(writerId)
      },
      abort: async () => {
        if (closed) return
        closed = true
        await this.api.abortWriter(writerId)
      },
    }
    return writable as unknown as FileSystemWritableFileStream
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    throw new DOMException('Synchronous access is unavailable for native workspace files', 'NotSupportedError')
  }

  async move(parent: FileSystemDirectoryHandle, newName: string): Promise<void> {
    invalidName(newName)
    const nextPath = [...pathOf(parent), newName]
    await this.api.moveFile(this.__freecutWorkspacePath, nextPath)
    this.__freecutWorkspacePath.splice(0, this.__freecutWorkspacePath.length, ...nextPath)
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    try {
      return JSON.stringify(this.__freecutWorkspacePath) === JSON.stringify(pathOf(other as FileSystemFileHandle))
    } catch {
      return false
    }
  }
}

class NativeDirectoryHandle implements NativeHandleInternals {
  readonly kind = 'directory' as const
  readonly __freecutWorkspacePath: string[]

  constructor(
    private readonly api: NativeWorkspaceApi,
    private readonly rootName: string,
    segments: string[],
  ) {
    this.__freecutWorkspacePath = [...segments]
  }

  get name(): string {
    return this.__freecutWorkspacePath.at(-1) ?? this.rootName
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
    invalidName(name)
    const segments = [...this.__freecutWorkspacePath, name]
    const exists = await this.api.getEntry(segments, 'directory', options?.create === true)
    if (!exists) throw notFound(`Directory not found: ${name}`)
    return new NativeDirectoryHandle(this.api, this.rootName, segments) as unknown as FileSystemDirectoryHandle
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    invalidName(name)
    const segments = [...this.__freecutWorkspacePath, name]
    const exists = await this.api.getEntry(segments, 'file', options?.create === true)
    if (!exists) throw notFound(`File not found: ${name}`)
    return new NativeFileHandle(this.api, segments)
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    invalidName(name)
    await this.api.removeEntry(
      [...this.__freecutWorkspacePath, name],
      options?.recursive === true,
    )
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    const entries = await this.api.list(this.__freecutWorkspacePath)
    if (!entries) throw notFound(`Directory not found: ${this.name}`)
    for (const entry of entries) {
      yield [entry.name, entry.kind === 'directory'
        ? new NativeDirectoryHandle(this.api, this.rootName, [...this.__freecutWorkspacePath, entry.name])
        : new NativeFileHandle(this.api, [...this.__freecutWorkspacePath, entry.name])]
    }
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for await (const [, entry] of this.entries()) yield entry
  }

  async *keys(): AsyncIterableIterator<string> {
    for await (const [name] of this.entries()) yield name
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]> {
    return this.entries()
  }

  async resolve(
    possibleDescendant: FileSystemHandle,
  ): Promise<string[] | null> {
    try {
      const descendantPath = pathOf(possibleDescendant as FileSystemDirectoryHandle)
      if (descendantPath.length < this.__freecutWorkspacePath.length) return null
      for (let i = 0; i < this.__freecutWorkspacePath.length; i++) {
        if (descendantPath[i] !== this.__freecutWorkspacePath[i]) return null
      }
      return descendantPath.slice(this.__freecutWorkspacePath.length)
    } catch {
      return null
    }
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    try {
      return JSON.stringify(this.__freecutWorkspacePath) === JSON.stringify(pathOf(other as FileSystemDirectoryHandle))
    } catch {
      return false
    }
  }
}

export async function getNativeWorkspaceRoot(): Promise<FileSystemDirectoryHandle | null> {
  const bridge = (window as NativeWorkspaceWindow).luna?.freecutWorkspace
  if (!bridge) return null
  const root = await bridge.ensureRoot()
  return new NativeDirectoryHandle(bridge, root.name, []) as unknown as FileSystemDirectoryHandle
}
