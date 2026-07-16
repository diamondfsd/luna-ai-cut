import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const MAX_MODEL_BYTES = 1024 * 1024 * 1024

export interface ModelFileDefinition {
  fileName: string
  url: string
  sha256: string
  sizeBytes: number
}

export interface ModelFileProgress {
  completedBytes: number
  totalBytes: number
}

interface ModelFileOptions {
  signal?: AbortSignal
  onProgress?: (progress: ModelFileProgress) => void
  fetcher?: typeof fetch
}

async function fileSha256(filePath: string, signal?: AbortSignal): Promise<string | null> {
  const hash = createHash('sha256')
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    fileHandle = await open(filePath, 'r')
    const chunk = new Uint8Array(1024 * 1024)
    for (;;) {
      signal?.throwIfAborted()
      const { bytesRead } = await fileHandle.read(chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      hash.update(chunk.subarray(0, bytesRead))
    }
    return hash.digest('hex')
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  } finally {
    await fileHandle?.close().catch(() => undefined)
  }
}

function downloadSize(response: Response, expectedBytes: number): number {
  const declared = Number(response.headers.get('content-length'))
  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_MODEL_BYTES) {
    throw new Error('模型文件大小异常')
  }
  if (Number.isFinite(declared) && declared > MAX_MODEL_BYTES) throw new Error('模型文件大小异常')
  return expectedBytes
}

interface WritableModelFile {
  write(buffer: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>
}

export async function writeAll(file: WritableModelFile, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset, null)
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) throw new Error('模型文件写入失败')
    offset += bytesWritten
  }
}

export async function loadVerifiedModelFile(
  modelDir: string,
  definition: ModelFileDefinition,
  options: ModelFileOptions = {},
): Promise<string> {
  const { signal, onProgress, fetcher = fetch } = options
  signal?.throwIfAborted()
  await mkdir(modelDir, { recursive: true })

  const modelPath = path.join(modelDir, definition.fileName)
  const cachedSha = await fileSha256(modelPath, signal)
  if (cachedSha === definition.sha256) {
    onProgress?.({ completedBytes: definition.sizeBytes, totalBytes: definition.sizeBytes })
    return modelPath
  }
  await rm(modelPath, { recursive: true, force: true })

  const temporaryPath = `${modelPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.download`
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null
  try {
    const response = await fetcher(definition.url, { redirect: 'follow', signal })
    if (!response.ok) throw new Error(`模型下载失败 (${response.status})`)
    const totalBytes = downloadSize(response, definition.sizeBytes)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('模型下载没有返回文件内容')

    fileHandle = await open(temporaryPath, 'wx', 0o600)
    const hash = createHash('sha256')
    let completedBytes = 0
    onProgress?.({ completedBytes, totalBytes })
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      completedBytes += value.byteLength
      if (completedBytes > totalBytes) throw new Error('模型文件大小异常')
      await writeAll(fileHandle, value)
      hash.update(value)
      onProgress?.({ completedBytes, totalBytes })
    }
    if (completedBytes !== totalBytes) throw new Error('模型文件大小异常')
    await fileHandle.close()
    fileHandle = null

    if (hash.digest('hex') !== definition.sha256) throw new Error('模型文件校验失败，请重试')
    signal?.throwIfAborted()
    await rename(temporaryPath, modelPath)
    return modelPath
  } finally {
    await fileHandle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
