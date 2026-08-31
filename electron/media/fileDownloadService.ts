import { createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import type { DownloadProgress, LunaFile } from '../../src/shared/types'

const USER_AGENT = 'LunaAI-Cut/0.1'

function isFileUrl(url: string): boolean {
  return url.startsWith('file:')
}

function partialPathFor(destination: string): string {
  return `${destination}.tmp`
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size
  } catch {
    return 0
  }
}

function parseContentRangeTotal(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^bytes\s+(?:\d+-\d+|\*)\/(?<total>\d+)$/i)
  return match?.groups ? Number(match.groups.total) : null
}

function responseTotal(statusCode: number | undefined, headers: http.IncomingHttpHeaders, existing: number): number | null {
  const rangeTotal = parseContentRangeTotal(String(headers['content-range'] ?? ''))
  if (rangeTotal !== null) return rangeTotal

  const lengthHeader = headers['content-length']
  const length = Array.isArray(lengthHeader) ? Number(lengthHeader[0]) : Number(lengthHeader)
  if (!Number.isFinite(length)) return null

  return statusCode === 206 ? existing + length : length
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    const cancel = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(abortError())
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function abortError(): Error {
  const error = new Error('下载已取消')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function isTransientDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const code = 'code' in error ? String(error.code).toUpperCase() : ''
  return (
    message === 'aborted'
    || message.includes('socket hang up')
    || message.includes('premature close')
    || message.includes('下载请求超时')
    || message.includes('timeout')
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
    || code === 'EHOSTUNREACH'
    || code === 'ENETUNREACH'
    || code === 'ECONNREFUSED'
    || code === 'ENETDOWN'
    || code === 'EAI_AGAIN'
    || code === 'EBUSY'
    || message.includes('resource busy or locked')
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function httpGet(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const parsed = new URL(url)
    const transport = parsed.protocol === 'https:' ? https : http
    const request = transport.get(
      parsed,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'identity',
          ...headers,
        },
      },
      (response) => resolve(response),
    )

    request.setTimeout(12000, () => request.destroy(new Error('下载请求超时')))
    request.on('error', reject)
    signal?.addEventListener('abort', () => request.destroy(abortError()), { once: true })
  })
}

export async function downloadToFile(
  item: Pick<LunaFile, 'name' | 'bytes'> & { sourceUrl?: string; url?: string },
  destination: string,
  onProgress?: (progress: Omit<DownloadProgress, 'index' | 'totalFiles' | 'status'>) => void,
  signal?: AbortSignal,
): Promise<string> {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  throwIfAborted(signal)
  const itemSourceUrl = item.sourceUrl || item.url
  if (!itemSourceUrl) throw new Error(`缺少下载地址：${item.name}`)

  if (isFileUrl(itemSourceUrl)) {
    const sourcePath = fileURLToPath(itemSourceUrl)
    const sourceSize = (await fs.stat(sourcePath)).size
    if (sourceSize <= 0) throw new Error(`下载内容为空：${item.name}`)
    const existingFinal = await fileSize(destination)
    if (existingFinal > 0) {
      onProgress?.({
        fileName: item.name,
        downloaded: existingFinal,
        total: existingFinal,
        percent: 100,
        speedBps: 0,
      })
      return destination
    }

    const partialPath = partialPathFor(destination)
    await fs.rm(partialPath, { force: true, maxRetries: 5, retryDelay: 200 })
    throwIfAborted(signal)
    const input = createReadStream(sourcePath)
    const output = createWriteStream(partialPath)
    let copied = 0
    const startedAt = Date.now()
    let lastEmit = 0

    const onData = (chunk: Buffer): void => {
      copied += chunk.length
      const now = Date.now()
      if (now - lastEmit > 120 || copied >= sourceSize) {
        const elapsed = Math.max((now - startedAt) / 1000, 0.001)
        onProgress?.({
          fileName: item.name,
          downloaded: copied,
          total: sourceSize,
          percent: sourceSize ? Math.min(100, (copied / sourceSize) * 100) : 100,
          speedBps: copied / elapsed,
        })
        lastEmit = now
      }
    }
    input.on('data', onData)
    try {
      await pipeline(
        input as unknown as NodeJS.ReadableStream,
        output as unknown as NodeJS.WritableStream,
        { signal },
      )
    } finally {
      input.off('data', onData)
    }

    throwIfAborted(signal)
    if (copied <= 0) throw new Error(`下载内容为空：${item.name}`)
    await fs.rename(partialPath, destination)
    onProgress?.({
      fileName: item.name,
      downloaded: copied,
      total: sourceSize,
      percent: 100,
      speedBps: 0,
    })
    return destination
  }

  const existingFinal = await fileSize(destination)
  if (existingFinal > 0) {
    onProgress?.({
      fileName: item.name,
      downloaded: existingFinal,
      total: existingFinal,
      percent: 100,
      speedBps: 0,
    })
    return destination
  }

  const partialPath = partialPathFor(destination)
  let existingPartial = await fileSize(partialPath)
  if (existingPartial < 0) existingPartial = 0

  const response = await httpGet(
    itemSourceUrl,
    existingPartial > 0 ? { Range: `bytes=${existingPartial}-`, Connection: 'close' } : { Connection: 'close' },
    signal,
  )

  if (response.statusCode !== 200 && response.statusCode !== 206) {
    response.destroy()
    throw new Error(`HTTP ${response.statusCode ?? '未知'}：${item.name}`)
  }

  let append = existingPartial > 0 && response.statusCode === 206
  if (append) {
    const contentRange = String(response.headers['content-range'] ?? '')
    const rangeStart = contentRange.match(/^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/i)?.[1]
    append = Number(rangeStart) === existingPartial
  }

  // Some camera firmware accepts Range but answers with the complete file. Reusing that body at the
  // old offset would corrupt the media, so truncate and treat it as a fresh download.
  const startOffset = append ? existingPartial : 0
  const total = responseTotal(response.statusCode, response.headers, startOffset) ?? item.bytes
  const output = createWriteStream(partialPath, { flags: append ? 'a' : 'w' })
  let downloaded = startOffset
  const startedAt = Date.now()
  let lastEmit = 0

  const onData = (chunk: Buffer): void => {
    downloaded += chunk.length
    const now = Date.now()
    if (now - lastEmit > 120 || (total !== null && downloaded >= total)) {
      const elapsed = Math.max((now - startedAt) / 1000, 0.001)
      onProgress?.({
        fileName: item.name,
        downloaded,
        total,
        percent: total ? Math.min(100, (downloaded / total) * 100) : null,
        speedBps: downloaded / elapsed,
      })
      lastEmit = now
    }
  }
  response.on('data', onData)
  try {
    await pipeline(
      response as unknown as NodeJS.ReadableStream,
      output as unknown as NodeJS.WritableStream,
      { signal },
    )
  } finally {
    response.off('data', onData)
  }

  throwIfAborted(signal)
  if (total !== null && downloaded < total) {
    throw new Error(`下载不完整：${downloaded}/${total}`)
  }
  if (downloaded <= 0) throw new Error(`下载内容为空：${item.name}`)

  await fs.rename(partialPath, destination)
  return destination
}

async function downloadToFileWithRetryInternal(
  item: Pick<LunaFile, 'name' | 'bytes'> & { sourceUrl?: string; url?: string },
  destination: string,
  onProgress?: (progress: Omit<DownloadProgress, 'index' | 'totalFiles' | 'status'>) => void,
  signal?: AbortSignal,
): Promise<string> {
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await downloadToFile(item, destination, onProgress, signal)
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError()
      if (!isTransientDownloadError(error) || attempt === maxAttempts - 1) throw error

      await delay(350 * (attempt + 1), signal)
    }
  }

  throw new Error(`下载失败：${item.name}`)
}

const activeDownloadTasks = new Map<string, Promise<string>>()

function downloadTaskKey(destination: string): string {
  const resolved = path.resolve(destination)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function downloadToFileWithRetry(
  item: Pick<LunaFile, 'name' | 'bytes'> & { sourceUrl?: string; url?: string },
  destination: string,
  onProgress?: (progress: Omit<DownloadProgress, 'index' | 'totalFiles' | 'status'>) => void,
  signal?: AbortSignal,
): Promise<string> {
  const key = downloadTaskKey(destination)
  const activeTask = activeDownloadTasks.get(key)
  if (activeTask) return activeTask

  const task = downloadToFileWithRetryInternal(item, destination, onProgress, signal)
  activeDownloadTasks.set(key, task)
  const clearTask = (): void => {
    if (activeDownloadTasks.get(key) === task) activeDownloadTasks.delete(key)
  }
  void task.then(clearTask, clearTask)
  return task
}
