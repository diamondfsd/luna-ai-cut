import { createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DownloadProgress, LunaFile } from '../src/shared/types'

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
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function abortError(): Error {
  const error = new Error('下载已取消')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isTransientDownloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  const code = 'code' in error ? String(error.code) : ''
  return (
    message === 'aborted'
    || message.includes('socket hang up')
    || message.includes('premature close')
    || code === 'ECONNRESET'
    || code === 'EPIPE'
    || code === 'ETIMEDOUT'
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
    await fs.rm(partialPath, { force: true })
    const input = createReadStream(sourcePath)
    const output = createWriteStream(partialPath)
    let copied = 0
    const startedAt = Date.now()
    let lastEmit = 0

    await new Promise<void>((resolve, reject) => {
      const cancel = (): void => {
        input.destroy(abortError())
        output.destroy(abortError())
        reject(abortError())
      }
      signal?.addEventListener('abort', cancel, { once: true })
      input.on('data', (chunk: Buffer) => {
        if (signal?.aborted) {
          cancel()
          return
        }
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
      })
      input.on('error', reject)
      output.on('error', reject)
      output.on('finish', () => {
        signal?.removeEventListener('abort', cancel)
        resolve()
      })
      input.pipe(output)
    })

    throwIfAborted(signal)
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
  await fs.rm(partialPath, { force: true })

  const response = await httpGet(itemSourceUrl, {}, signal)

  if (response.statusCode !== 200) {
    response.destroy()
    throw new Error(`HTTP ${response.statusCode ?? '未知'}：${item.name}`)
  }

  const total = responseTotal(response.statusCode, response.headers, 0) ?? item.bytes
  const output = createWriteStream(partialPath, { flags: 'w' })
  let downloaded = 0
  const startedAt = Date.now()
  let lastEmit = 0

  await new Promise<void>((resolve, reject) => {
    const cancel = (): void => {
      response.destroy(abortError())
      output.destroy(abortError())
      reject(abortError())
    }
    signal?.addEventListener('abort', cancel, { once: true })
    response.on('data', (chunk: Buffer) => {
      if (signal?.aborted) {
        cancel()
        return
      }
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
    })
    response.on('error', reject)
    output.on('error', reject)
    output.on('finish', () => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    })
    response.pipe(output)
  })

  throwIfAborted(signal)
  if (total !== null && downloaded < total) {
    throw new Error(`下载不完整：${downloaded}/${total}`)
  }

  await fs.rename(partialPath, destination)
  return destination
}

export async function downloadToFileWithRetry(
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

      await delay(350 * (attempt + 1))
    }
  }

  throw new Error(`下载失败：${item.name}`)
}
