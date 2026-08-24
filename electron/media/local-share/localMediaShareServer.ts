import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { join } from 'node:path'
import { listSharedFileItems, safeRelativePath, type LocalMediaShareFileRoot, type SharedFileRecord } from './localMediaShareFiles.ts'
import type { LocalMediaShareSource } from '../../../src/shared/types/localMediaShare'
import { streamZip } from './localMediaShareZip.ts'

export interface ShareResourceRecord {
  id: string
  source: LocalMediaShareSource
  absolutePath: string
  name: string
  mimeType: string
  size: number
  createdAt: number
  previewKind: 'image' | 'video' | 'download-only'
  sourceLabel?: string
}

export interface LocalMediaShareServerOptions {
  address: string
  assetsDir: string
  resources: ShareResourceRecord[]
  thumbnail?: (resource: ShareResourceRecord) => Promise<Buffer | null>
  upload?: (request: IncomingMessage, fileName: string) => Promise<ShareResourceRecord>
  sharedFileRoots?: () => Promise<LocalMediaShareFileRoot[]>
}

export interface RunningLocalMediaShareServer {
  address: string
  port: number
  token: string
  url: string
  stop(): Promise<void>
}

interface ByteRange {
  start: number
  end: number
}

const MAX_STREAMS = 6
const MAX_ZIP_RESOURCES = 100

export function parseByteRange(value: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0) return 'invalid'
  const startText = match[1]
  const endText = match[2]
  if (!startText && !endText) return 'invalid'

  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return 'invalid'
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function publicResource(resource: ShareResourceRecord) {
  return {
    id: resource.id,
    source: resource.source,
    name: resource.name,
    mimeType: resource.mimeType,
    size: resource.size,
    createdAt: resource.createdAt,
    previewKind: resource.previewKind,
    sourceLabel: resource.sourceLabel,
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function asciiFileName(name: string): string {
  const cleaned = [...name].map((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 || character === '"' || character === '\\' || character === '/'
      ? '_'
      : character
  }).join('').trim()
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_')
  return ascii || 'download'
}

function contentDisposition(name: string): string {
  return `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function decodeId(value: string | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

async function readSharedFileRoots(options: LocalMediaShareServerOptions): Promise<LocalMediaShareFileRoot[]> {
  if (!options.sharedFileRoots) return []
  try {
    return await options.sharedFileRoots()
  } catch {
    return []
  }
}

export async function startLocalMediaShareServer(options: LocalMediaShareServerOptions): Promise<RunningLocalMediaShareServer> {
  const token = randomBytes(24).toString('base64url')
  const basePath = `/s/${token}`
  const resources = [...options.resources].sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]))
  const sharedFileMap = new Map<string, SharedFileRecord>()
  const streams = new Set<ReturnType<typeof createReadStream>>()
  const sockets = new Set<Socket>()
  let accepting = true

  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')

    if (!accepting) {
      response.writeHead(503)
      response.end()
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, HEAD, POST')
      response.writeHead(405)
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', `http://${options.address}`)
    const pathname = requestUrl.pathname
    const sessionPrefix = '/s/'
    const sessionEnd = pathname.indexOf('/', sessionPrefix.length)
    const candidateToken = pathname.startsWith(sessionPrefix)
      ? pathname.slice(sessionPrefix.length, sessionEnd < 0 ? undefined : sessionEnd)
      : ''
    const tokenMatches = candidateToken.length === token.length
      && timingSafeEqual(Buffer.from(candidateToken), Buffer.from(token))
    if (!tokenMatches) {
      response.writeHead(404)
      response.end()
      return
    }

    const relativePath = sessionEnd < 0 ? '' : pathname.slice(sessionEnd + 1)
    const staticAsset = !relativePath
      ? { file: 'index.html', mimeType: 'text/html; charset=utf-8' }
      : relativePath === 'app.css'
        ? { file: 'app.css', mimeType: 'text/css; charset=utf-8' }
        : relativePath === 'app-actions.css'
          ? { file: 'app-actions.css', mimeType: 'text/css; charset=utf-8' }
        : relativePath === 'app.js'
          ? { file: 'app.js', mimeType: 'text/javascript; charset=utf-8' }
          : null
    if (staticAsset) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        response.writeHead(405)
        response.end()
        return
      }
      try {
        const bytes = await readFile(join(options.assetsDir, staticAsset.file))
        response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        response.writeHead(200, { 'Content-Type': staticAsset.mimeType, 'Content-Length': bytes.length })
        response.end(request.method === 'HEAD' ? undefined : bytes)
      } catch {
        response.writeHead(500)
        response.end()
      }
      return
    }

    if (relativePath === 'api/resources') {
      const source = requestUrl.searchParams.get('source')
      const filtered = source === 'local' || source === 'export' || source === 'custom'
        ? resources.filter((resource) => resource.source === source)
        : resources
      const rawLimit = Number(requestUrl.searchParams.get('limit') ?? 60)
      const limit = Number.isSafeInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 60
      const rawCursor = Number(requestUrl.searchParams.get('cursor') ?? 0)
      const cursor = Number.isSafeInteger(rawCursor) ? Math.min(filtered.length, Math.max(0, rawCursor)) : 0
      const items = filtered.slice(cursor, cursor + limit).map(publicResource)
      const nextCursor = cursor + items.length < filtered.length ? String(cursor + items.length) : null
      writeJson(response, 200, { items, nextCursor, total: filtered.length })
      return
    }

    if (relativePath === 'api/files') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        response.writeHead(405)
        response.end()
        return
      }
      const roots = await readSharedFileRoots(options)
      const rootId = requestUrl.searchParams.get('root')
      const requestedPath = safeRelativePath(requestUrl.searchParams.get('path'))
      if (requestedPath === null) {
        writeJson(response, 400, { error: '目录位置无效' })
        return
      }
      if (!rootId) {
        writeJson(response, 200, {
          roots: roots.map((root) => ({ id: root.id, name: root.name, kind: root.filePaths ? 'files' : 'directory' })),
          rootId: null,
          path: '',
          parentPath: null,
          items: [],
          total: roots.length,
        })
        return
      }
      const root = roots.find((candidate) => candidate.id === rootId)
      if (!root) {
        writeJson(response, 404, { error: '共享目录不存在' })
        return
      }
      const result = await listSharedFileItems(root, requestedPath, sharedFileMap)
      const currentPath = result.path
      const parentPath = currentPath ? currentPath.split('/').slice(0, -1).join('/') : null
      writeJson(response, 200, {
        roots: roots.map((candidate) => ({ id: candidate.id, name: candidate.name, kind: candidate.filePaths ? 'files' : 'directory' })),
        rootId: root.id,
        path: currentPath,
        parentPath,
        rootName: root.name,
        items: result.items,
        total: result.items.length,
      })
      return
    }

    if (relativePath === 'api/upload') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST')
        response.writeHead(405)
        response.end()
        return
      }
      if (!options.upload) {
        response.writeHead(503)
        response.end()
        return
      }
      const encodedName = request.headers['x-file-name']
      const rawName = Array.isArray(encodedName) ? encodedName[0] : encodedName
      let fileName = rawName ?? ''
      try {
        fileName = decodeURIComponent(fileName)
      } catch {
        response.writeHead(400)
        response.end()
        return
      }
      try {
        const resource = await options.upload(request, fileName)
        resources.push(resource)
        resources.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
        resourceMap.set(resource.id, resource)
        writeJson(response, 201, { item: publicResource(resource) })
      } catch (error) {
        request.resume()
        const message = error instanceof Error ? error.message : '上传失败，请重试'
        const status = message.includes('过大') ? 413 : message.includes('只支持') ? 415 : 400
        writeJson(response, status, { error: message })
      }
      return
    }

    if (relativePath === 'download-zip') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        response.writeHead(405)
        response.end()
        return
      }
      const ids = [...new Set(requestUrl.searchParams.getAll('id'))].map(decodeId).filter((id): id is string => id !== null).slice(0, MAX_ZIP_RESOURCES)
      const selected = ids.map((id) => resourceMap.get(id)).filter((resource): resource is ShareResourceRecord => resource !== undefined)
      if (selected.length === 0) {
        response.writeHead(400)
        response.end()
        return
      }
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition('Luna AI Cut 资源.zip'),
        'Transfer-Encoding': 'chunked',
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      try {
        await streamZip(selected, response)
      } catch {
        response.destroy()
      }
      return
    }

    if (relativePath.startsWith('file-download/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD')
        response.writeHead(405)
        response.end()
        return
      }
      const [kind, encodedId, extra] = relativePath.split('/')
      const id = extra ? null : decodeId(encodedId)
      const file = id ? sharedFileMap.get(id) : undefined
      if (kind !== 'file-download' || !file) {
        response.writeHead(404)
        response.end()
        return
      }
      let fileStat
      try {
        const resolvedPath = await realpath(file.absolutePath)
        fileStat = await stat(resolvedPath)
        if (!fileStat.isFile()) throw new Error('not a file')
        file.absolutePath = resolvedPath
        file.size = fileStat.size
        file.modifiedAt = fileStat.mtimeMs
      } catch {
        response.writeHead(404)
        response.end()
        return
      }
      if (streams.size >= MAX_STREAMS) {
        response.writeHead(429, { 'Retry-After': '1' })
        response.end()
        return
      }
      const range = parseByteRange(request.headers.range, file.size)
      if (range === 'invalid') {
        response.writeHead(416, { 'Content-Range': `bytes */${file.size}` })
        response.end()
        return
      }
      const start = range?.start ?? 0
      const end = range?.end ?? Math.max(0, file.size - 1)
      const contentLength = file.size === 0 ? 0 : end - start + 1
      const headers: Record<string, string | number> = {
        'Accept-Ranges': 'bytes',
        'Content-Type': file.mimeType,
        'Content-Length': contentLength,
        'Content-Disposition': contentDisposition(file.name),
      }
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`
      response.writeHead(range ? 206 : 200, headers)
      if (request.method === 'HEAD' || file.size === 0) {
        response.end()
        return
      }
      const stream = createReadStream(file.absolutePath, { start, end })
      streams.add(stream)
      const cleanup = () => streams.delete(stream)
      stream.once('close', cleanup)
      stream.once('error', () => response.destroy())
      response.once('close', () => {
        if (!response.writableEnded) stream.destroy()
      })
      stream.pipe(response)
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD')
      response.writeHead(405)
      response.end()
      return
    }

    const [kind, encodedId, extra] = relativePath.split('/')
    if (extra || !['media', 'download', 'thumb'].includes(kind)) {
      response.writeHead(404)
      response.end()
      return
    }
    const id = decodeId(encodedId)
    const resource = id ? resourceMap.get(id) : undefined
    if (!resource) {
      response.writeHead(404)
      response.end()
      return
    }

    if (kind === 'thumb') {
      if (request.method === 'HEAD') {
        response.writeHead(200, { 'Content-Type': 'image/jpeg' })
        response.end()
        return
      }
      try {
        const thumbnail = await options.thumbnail?.(resource)
        if (thumbnail && thumbnail.length > 0) {
          response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': thumbnail.length })
          response.end(thumbnail)
          return
        }
      } catch {
        // Fall back to the original image where possible.
      }
      if (resource.previewKind !== 'image') {
        response.writeHead(404)
        response.end()
        return
      }
    }

    if (streams.size >= MAX_STREAMS) {
      response.writeHead(429, { 'Retry-After': '1' })
      response.end()
      return
    }

    const range = parseByteRange(request.headers.range, resource.size)
    if (range === 'invalid') {
      response.writeHead(416, { 'Content-Range': `bytes */${resource.size}` })
      response.end()
      return
    }
    const start = range?.start ?? 0
    const end = range?.end ?? Math.max(0, resource.size - 1)
    const contentLength = resource.size === 0 ? 0 : end - start + 1
    const headers: Record<string, string | number> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': resource.mimeType,
      'Content-Length': contentLength,
    }
    if (kind === 'download') headers['Content-Disposition'] = contentDisposition(resource.name)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${resource.size}`
    response.writeHead(range ? 206 : 200, headers)
    if (request.method === 'HEAD' || resource.size === 0) {
      response.end()
      return
    }

    const stream = createReadStream(resource.absolutePath, { start, end })
    streams.add(stream)
    const cleanup = () => streams.delete(stream)
    stream.once('close', cleanup)
    stream.once('error', () => response.destroy())
    response.once('close', () => {
      if (!response.writableEnded) stream.destroy()
    })
    stream.pipe(response)
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(0, options.address, () => {
      server.off('error', onError)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法确定分享端口')

  return {
    address: options.address,
    port: address.port,
    token,
    url: `http://${options.address}:${address.port}${basePath}/`,
    stop: async () => {
      if (!accepting) return
      accepting = false
      for (const stream of streams) stream.destroy()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
