import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024

export interface DownloadDefinition {
  fileName: string
  url: string
  sha256: string
  sizeBytes: number
}

export interface DownloadProgress {
  completedBytes: number
  totalBytes: number
  resumedBytes: number
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
  fetcher?: typeof fetch
  maxBytes?: number
  label?: string
}

interface WritableFile {
  write(buffer: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>
}

export async function writeAll(file: WritableFile, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset, null)
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) throw new Error('资源文件写入失败')
    offset += bytesWritten
  }
}

export async function fileSha256(filePath: string, signal?: AbortSignal): Promise<string | null> {
  const hash = createHash('sha256')
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(filePath, 'r')
    const chunk = new Uint8Array(1024 * 1024)
    for (;;) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      hash.update(chunk.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function validateDefinition(definition: DownloadDefinition, maxBytes: number, label: string): void {
  if (path.basename(definition.fileName) !== definition.fileName || !definition.fileName) {
    throw new Error(`${label}文件名不安全`)
  }
  if (!Number.isInteger(definition.sizeBytes) || definition.sizeBytes <= 0 || definition.sizeBytes > maxBytes) {
    throw new Error(`${label}文件大小异常`)
  }
  if (!/^[a-f0-9]{64}$/.test(definition.sha256)) throw new Error(`${label}校验信息无效`)
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath)
    return info.isFile() ? info.size : -1
  } catch {
    return -1
  }
}

function rangeStartsAt(response: Response, offset: number, expectedBytes: number): boolean {
  if (response.status !== 206) return false
  const contentRange = response.headers.get('content-range') ?? ''
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(contentRange)
  if (!match) return false
  const [, start, end, total] = match.map(Number)
  return start === offset && end >= start && end < expectedBytes && total === expectedBytes
}

export async function downloadVerifiedFile(
  destinationDir: string,
  definition: DownloadDefinition,
  options: DownloadOptions = {},
): Promise<string> {
  const {
    signal,
    onProgress,
    fetcher = fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    label = '资源',
  } = options
  validateDefinition(definition, maxBytes, label)
  signal?.throwIfAborted()
  await mkdir(destinationDir, { recursive: true })

  const finalPath = path.join(destinationDir, definition.fileName)
  if (await fileSha256(finalPath, signal) === definition.sha256) {
    onProgress?.({ completedBytes: definition.sizeBytes, totalBytes: definition.sizeBytes, resumedBytes: definition.sizeBytes })
    return finalPath
  }
  await rm(finalPath, { recursive: true, force: true })

  const temporaryPath = path.join(destinationDir, `${definition.fileName}.${definition.sha256.slice(0, 16)}.download`)
  let resumedBytes = await fileSize(temporaryPath)
  if (resumedBytes < 0) resumedBytes = 0
  if (resumedBytes > definition.sizeBytes) {
    await rm(temporaryPath, { force: true })
    resumedBytes = 0
  }

  if (resumedBytes === definition.sizeBytes) {
    if (await fileSha256(temporaryPath, signal) === definition.sha256) {
      signal?.throwIfAborted()
      await rename(temporaryPath, finalPath)
      onProgress?.({ completedBytes: definition.sizeBytes, totalBytes: definition.sizeBytes, resumedBytes })
      return finalPath
    }
    await rm(temporaryPath, { force: true })
    resumedBytes = 0
  }

  const requestHeaders = resumedBytes > 0 ? { Range: `bytes=${resumedBytes}-` } : undefined
  const response = await fetcher(definition.url, { redirect: 'follow', signal, headers: requestHeaders })
  if (!response.ok) throw new Error(`${label}下载失败 (${response.status})`)

  const append = resumedBytes > 0 && rangeStartsAt(response, resumedBytes, definition.sizeBytes)
  if (resumedBytes > 0 && response.status === 206 && !append) {
    throw new Error(`${label}断点响应异常，请重试`)
  }
  if (!append) resumedBytes = 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`${label}下载没有返回文件内容`)

  let handle: Awaited<ReturnType<typeof open>> | null = null
  let completedBytes = resumedBytes
  try {
    handle = await open(temporaryPath, append ? 'a' : 'w', 0o600)
    onProgress?.({ completedBytes, totalBytes: definition.sizeBytes, resumedBytes })
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      completedBytes += value.byteLength
      if (completedBytes > definition.sizeBytes || completedBytes > maxBytes) {
        await handle.close()
        handle = null
        await rm(temporaryPath, { force: true })
        throw new Error(`${label}文件大小异常`)
      }
      await writeAll(handle, value)
      onProgress?.({ completedBytes, totalBytes: definition.sizeBytes, resumedBytes })
    }
    await handle.close()
    handle = null
    if (completedBytes !== definition.sizeBytes) throw new Error(`${label}文件大小异常`)
    if (await fileSha256(temporaryPath, signal) !== definition.sha256) {
      await rm(temporaryPath, { force: true })
      throw new Error(`${label}文件校验失败，请重试`)
    }
    signal?.throwIfAborted()
    await rename(temporaryPath, finalPath)
    return finalPath
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
