import {
  downloadVerifiedFile,
  writeAll,
  type DownloadOptions,
  type DownloadProgress,
} from './resumableDownloadService.js'

export interface ModelFileDefinition {
  fileName: string
  url: string
  mirrors?: readonly string[]
  sha256: string
  sizeBytes: number
}

export type ModelFileProgress = Pick<DownloadProgress, 'completedBytes' | 'totalBytes'>

interface ModelFileOptions {
  signal?: AbortSignal
  onProgress?: (progress: ModelFileProgress) => void
  fetcher?: typeof fetch
}

export { writeAll }

export async function loadVerifiedModelFile(
  modelDir: string,
  definition: ModelFileDefinition,
  options: ModelFileOptions = {},
): Promise<string> {
  const downloadOptions: DownloadOptions = {
    ...options,
    // The immutable definition is the limit. This permits large declared models
    // without turning the shared downloader into an unbounded file sink.
    maxBytes: definition.sizeBytes,
    label: '模型',
    onProgress: options.onProgress
      ? ({ completedBytes, totalBytes }) => options.onProgress?.({ completedBytes, totalBytes })
      : undefined,
  }
  return downloadVerifiedFile(modelDir, definition, downloadOptions)
}
