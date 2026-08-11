import { getMediaType, getMimeType, validateMediaFileContent } from './validation'
import { createMediaFileHandle } from './media-file-handle'

export interface ExtractedMediaFileEntry {
  handle: FileSystemFileHandle
  file: File
  mediaType: 'video' | 'audio' | 'image' | 'lottie' | 'unknown'
}

export interface ExtractedMediaFileDropResult {
  supported: boolean
  entries: ExtractedMediaFileEntry[]
  errors: string[]
}

export function formatMediaDropRejectionMessage(errors: string[]): string {
  const count = errors.length
  if (count === 0) return ''

  const examples = errors.slice(0, 3).join('; ')
  const overflow = count > 3 ? `; and ${count - 3} more` : ''
  const subject =
    count === 1 ? '1 dropped item was rejected' : `${count} dropped items were rejected`
  return `${subject}: ${examples}${overflow}.`
}

export async function extractValidMediaFileEntriesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<ExtractedMediaFileDropResult> {
  const items = Array.from(dataTransfer.items)
  const handlePromises: Promise<FileSystemHandle | null>[] = []
  for (const item of items) {
    if ('getAsFileSystemHandle' in item) {
      handlePromises.push(item.getAsFileSystemHandle())
    }
  }

  const resolvedHandles = handlePromises.length > 0
    ? await Promise.all(handlePromises.map((promise) => promise.catch(() => null)))
    : []
  const rawHandles = resolvedHandles.some(Boolean)
    ? resolvedHandles
    : Array.from(dataTransfer.files).map(createMediaFileHandle)
  if (rawHandles.length === 0) {
    return { supported: false, entries: [], errors: [] }
  }
  const entries: ExtractedMediaFileEntry[] = []
  const errors: string[] = []

  for (const handle of rawHandles) {
    if (!handle) {
      continue
    }

    if (handle.kind !== 'file') {
      const name = 'name' in handle ? handle.name : 'Dropped folder'
      errors.push(`${name}: folders are not supported yet. Drop media files directly.`)
      continue
    }

    const fileHandle = handle as FileSystemFileHandle
    try {
      const file = await fileHandle.getFile()
      const validation = await validateMediaFileContent(file)
      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`)
        continue
      }

      entries.push({
        handle: fileHandle,
        file,
        mediaType: getMediaType(getMimeType(file)),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read file'
      errors.push(`Unknown file: ${message}`)
    }
  }

  return {
    supported: true,
    entries,
    errors,
  }
}
