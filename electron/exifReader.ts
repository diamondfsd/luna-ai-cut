import { open } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import { promisify } from 'node:util'
import { getFfprobePath } from './ffmpeg/pipeline'

export interface MediaDeviceInfo {
  make: string
  model: string
  firmware?: string
  serialNumber?: string
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.insv', '.lrv'])
const execFileAsync = promisify(execFile)
const REMOTE_TAIL_BYTES = 1024 * 1024
const REMOTE_REQUEST_TIMEOUT_MS = 15_000

async function readStandardVideoDeviceInfo(localPath: string): Promise<MediaDeviceInfo | null> {
  const { stdout } = await execFileAsync(getFfprobePath(), [
    '-v', 'error', '-print_format', 'json', '-show_format', localPath,
  ], { encoding: 'utf8', timeout: REMOTE_REQUEST_TIMEOUT_MS })
  const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }
  const tags = parsed.format?.tags ?? {}
  const make = tags.make?.trim() ?? ''
  const model = tags.model?.trim() ?? ''
  if (!make && !model) return null
  return {
    make,
    model,
    firmware: tags.firmware?.trim() || undefined,
    serialNumber: (tags.serial_number ?? tags.serialnumber)?.trim() || undefined,
  }
}

function parseInsta360VideoDeviceInfo(buffer: Buffer): MediaDeviceInfo | null {
  const tail = buffer.toString('latin1')
  const searchable = tail.replace(/[^ -~]/g, ' ')
  const model = /Insta360\s+(Luna Ultra|GO Ultra)/i.exec(searchable)?.[1] ?? null
  if (!model) return null
  const firmware = /\bv\d+\.\d+(?:\.\d+)+\b/i.exec(searchable)?.[0]
  const serialNumber = /\bBTLB[A-Z0-9]{8,}\b/i.exec(searchable)?.[0]
  return { make: 'Insta360', model, firmware, serialNumber }
}

async function readLocalInsta360VideoDeviceInfo(localPath: string): Promise<MediaDeviceInfo | null> {
  const handle = await open(localPath, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, REMOTE_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, stat.size - length)
    return parseInsta360VideoDeviceInfo(buffer)
  } finally {
    await handle.close()
  }
}

async function readRemoteRange(url: string, range: string): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve, reject) => {
    let settled = false
    const finish = (value: Buffer | null, error?: Error) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      finish(null)
      return
    }
    const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(parsed, {
      headers: { Accept: '*/*', Range: range },
      timeout: REMOTE_REQUEST_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0
      const contentLength = Number(response.headers['content-length'])
      const allowedFullResponse = status === 200 && Number.isFinite(contentLength) && contentLength <= REMOTE_TAIL_BYTES
      if (status !== 206 && !allowedFullResponse) {
        response.resume()
        finish(null)
        return
      }

      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > REMOTE_TAIL_BYTES) {
          response.destroy()
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => finish(Buffer.concat(chunks, total)))
      response.on('error', (error) => finish(null, error))
    })
    req.on('timeout', () => req.destroy(new Error('读取视频信息超时')))
    req.on('error', (error) => finish(null, error))
    req.end()
  }).catch(() => null)
}

async function readInsta360VideoDeviceInfo(source: string): Promise<MediaDeviceInfo | null> {
  if (/^https?:\/\//i.test(source)) {
    const tail = await readRemoteRange(source, `bytes=-${REMOTE_TAIL_BYTES}`)
    return tail ? parseInsta360VideoDeviceInfo(tail) : null
  }
  return readLocalInsta360VideoDeviceInfo(source)
}

function isVideoSource(source: string): boolean {
  try {
    const pathname = /^https?:\/\//i.test(source) ? new URL(source).pathname : source
    return VIDEO_EXTENSIONS.has(path.extname(pathname).toLowerCase())
  } catch {
    return false
  }
}

export async function readMediaDeviceInfo(source?: string): Promise<MediaDeviceInfo | null> {
  if (!source) return null
  if (isVideoSource(source)) {
    try {
      const standardInfo = await readStandardVideoDeviceInfo(source)
      if (standardInfo) return standardInfo
    } catch { /* fall through to Insta360 private metadata */ }
    try {
      const videoInfo = await readInsta360VideoDeviceInfo(source)
      if (videoInfo) return videoInfo
    } catch { /* fall through to regular metadata */ }
  }
  if (/^https?:\/\//i.test(source)) return null
  try {
    const exifr = await import('exifr')
    const parsed = await exifr.parse(source, { translateValues: false, pick: ['Model', 'Make'] }) as Record<string, unknown> | undefined
    const model = typeof parsed?.Model === 'string' ? parsed.Model.trim() : ''
    const make = typeof parsed?.Make === 'string' ? parsed.Make.trim() : ''
    return model || make ? { make, model } : null
  } catch {
    return null
  }
}

export async function readExifModel(localPath?: string): Promise<string | null> {
  const info = await readMediaDeviceInfo(localPath)
  return info ? [info.make, info.model].filter(Boolean).join(' ') || null : null
}
