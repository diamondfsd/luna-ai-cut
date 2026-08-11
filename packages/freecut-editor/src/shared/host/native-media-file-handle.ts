import {
  getEmbeddedHostBridge,
  type EmbeddedMediaImportSource,
} from './embedded-host'

interface NativeMediaHandleInternals {
  __freecutNativeMediaSource: EmbeddedMediaImportSource
}

export function nativeMediaSourceForHandle(
  handle: FileSystemFileHandle,
): EmbeddedMediaImportSource | null {
  return (handle as unknown as Partial<NativeMediaHandleInternals>).__freecutNativeMediaSource ?? null
}

export function createNativeMediaFileHandle(
  source: EmbeddedMediaImportSource,
): FileSystemFileHandle {
  const handle = {
    kind: 'file' as const,
    name: source.name,
    __freecutNativeMediaSource: source,
    getFile: async () => {
      const read = getEmbeddedHostBridge().readNativeMediaFile
      if (!read) throw new DOMException('Native media access is unavailable', 'NotSupportedError')
      const result = await read(source.path)
      return new File([result.bytes], result.name, {
        type: result.mimeType,
        lastModified: result.lastModified,
      })
    },
    queryPermission: async () => 'granted' as const,
    requestPermission: async () => 'granted' as const,
    isSameEntry: async (other: FileSystemHandle) =>
      nativeMediaSourceForHandle(other as FileSystemFileHandle)?.path === source.path,
  }

  return handle as unknown as FileSystemFileHandle
}

/**
 * Converts an Electron-backed browser handle into a durable native-path handle.
 * Standalone browser hosts keep their original File System Access handle.
 */
export async function resolveNativeMediaFileHandle(
  handle: FileSystemFileHandle,
): Promise<FileSystemFileHandle> {
  if (nativeMediaSourceForHandle(handle)) return handle

  const describe = getEmbeddedHostBridge().describeDroppedMediaFiles
  if (!describe) return handle

  try {
    const file = await handle.getFile()
    const [source] = await describe([file])
    return source ? createNativeMediaFileHandle(source) : handle
  } catch {
    return handle
  }
}
