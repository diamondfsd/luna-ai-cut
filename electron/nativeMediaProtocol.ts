import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat as statFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

const NATIVE_MEDIA_PROTOCOL = 'luna-media'
const NATIVE_MEDIA_HOST = 'app'

function nativeMediaFilePath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    // Chromium may canonicalize a custom standard scheme from
    // `luna-media://app/<encoded-path>` to `luna-media:/<encoded-path>` when
    // it is handed to a worker or a media decoder. In that form the path is
    // still unambiguous, so accept the empty host as the canonical equivalent
    // of the app host.
    if (
      url.protocol !== `${NATIVE_MEDIA_PROTOCOL}:` ||
      (url.hostname !== NATIVE_MEDIA_HOST && url.hostname !== '')
    ) {
      return null
    }

    // New URLs carry the absolute path in a query parameter. This avoids
    // Chromium rewriting an encoded leading slash in a custom-scheme path.
    // Keep accepting the original pathname form for already-created URLs.
    const encodedPath = url.searchParams.get('path') ??
      (url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname)
    if (!encodedPath) return null
    const filePath = decodeURIComponent(encodedPath)
    return path.isAbsolute(filePath) ? filePath : null
  } catch {
    return null
  }
}

function nativeMediaMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
    case '.m4v':
    case '.insv':
    case '.lrv':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mkv':
      return 'video/x-matroska'
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
      return 'audio/mp4'
    case '.wav':
      return 'audio/wav'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function nativeMediaHeaders(filePath: string, contentLength: number): Headers {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
    'Content-Length': String(contentLength),
    'Content-Type': nativeMediaMimeType(filePath),
  })
}

function parseNativeMediaRange(
  value: string | null,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return 'invalid'

  const [, startText, endText] = match
  if (!startText && !endText) return 'invalid'

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size === 0) return 'invalid'
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return 'invalid'
  }

  return { start, end: Math.min(requestedEnd, size - 1) }
}

export function registerNativeMediaProtocol(): void {
  protocol.handle(NATIVE_MEDIA_PROTOCOL, async (request) => {
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
    })
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers })
    }

    const filePath = nativeMediaFilePath(request.url)
    if (!filePath) return new Response('Not found', { status: 404, headers })

    let fileSize: number
    try {
      const fileStat = await statFile(filePath)
      if (!fileStat.isFile()) return new Response('Not found', { status: 404, headers })
      fileSize = fileStat.size
    } catch {
      return new Response('Not found', { status: 404, headers })
    }

    const range = parseNativeMediaRange(request.headers.get('range'), fileSize)
    if (range === 'invalid') {
      const invalidHeaders = nativeMediaHeaders(filePath, 0)
      invalidHeaders.set('Content-Range', `bytes */${fileSize}`)
      return new Response(null, { status: 416, headers: invalidHeaders })
    }

    const start = range?.start ?? 0
    const end = range?.end ?? Math.max(0, fileSize - 1)
    const contentLength = fileSize === 0 ? 0 : end - start + 1
    const responseHeaders = nativeMediaHeaders(filePath, contentLength)
    const status = range ? 206 : 200
    if (range) responseHeaders.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)

    const body =
      request.method === 'HEAD' || fileSize === 0
        ? null
        : (Readable.toWeb(
            createReadStream(filePath, { start, end }) as unknown as NodeJS.ReadableStream,
          ) as unknown as ReadableStream<Uint8Array>)
    return new Response(body, { status, headers: responseHeaders })
  })
}
