import {
  downloadVerifiedFile,
  writeAll,
  type DownloadOptions,
  type DownloadProgress,
} from './resumableDownloadService.js'

const MAX_MODEL_BYTES = 1024 * 1024 * 1024

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
    maxBytes: MAX_MODEL_BYTES,
    label: '模型',
    onProgress: options.onProgress
      ? ({ completedBytes, totalBytes }) => options.onProgress?.({ completedBytes, totalBytes })
      : undefined,
  }
  return downloadVerifiedFile(modelDir, definition, downloadOptions)
}
