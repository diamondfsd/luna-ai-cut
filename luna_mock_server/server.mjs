#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import path from 'node:path'
import { createHttpAuthGate } from './httpAuthGate.mjs'
const DEVICE_CONFIG = JSON.parse(readFileSync(new URL('../electron/deviceConfigs/luna-ultra.json', import.meta.url), 'utf-8'))
const STORAGE_PATHS = DEVICE_CONFIG.storages.map((s) => s.path)
const CAMERA_PATH = STORAGE_PATHS.find((p) => DEVICE_CONFIG.storages[STORAGE_PATHS.indexOf(p)].default) || STORAGE_PATHS[0] || '/'
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'dng', 'insp', 'webp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'lrv'])
const AUTH_PAYLOADS = [
  Buffer.from('55434432010c050f000000003705477c', 'hex'),
  Buffer.from('55434432010c04100f0000000800020100008000000830080f080b7c008e7c', 'hex'),
]
const EXPECTED_AUTH = Buffer.concat(AUTH_PAYLOADS)
const DEFAULT_MOCK = DEVICE_CONFIG.mock
const CAMERA_DIR_NAMES = ['Camera01', 'Camera02', 'Camera03']
const UCD2_MAGIC = Buffer.from('UCD2')
const UCD2_FILE = 0x04
const UCD2_STREAM = 0x05
const authGate = createHttpAuthGate(3000)
const deletedCameraPaths = new Set()

function argValue(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const rootArg = argValue('--root') || process.env.LUNA_MOCK_ROOT
if (!rootArg) {
  console.error('Missing mock media root. Pass --root <dir> or set LUNA_MOCK_ROOT.')
  process.exit(1)
}

const rootDir = path.resolve(rootArg)
const host = argValue('--host') || process.env.LUNA_MOCK_HOST || DEFAULT_MOCK.host
const httpPort = Number(argValue('--http-port') || process.env.LUNA_MOCK_HTTP_PORT || DEFAULT_MOCK.httpPort)
const tcpPort = Number(argValue('--tcp-port') || process.env.LUNA_MOCK_TCP_PORT || DEFAULT_MOCK.tcpPort)
const rateBps = Number(argValue('--rate-mbps') || process.env.LUNA_MOCK_RATE_MBPS || DEFAULT_MOCK.rateMbps) * 1024 * 1024

function isStreamHandshake(frame) {
  return frame[6] === UCD2_STREAM && frame.length >= 16
}

function buildUcd2(type, seq, payload) {
  const header = Buffer.alloc(8)
  UCD2_MAGIC.copy(header, 0)
  header[4] = 0x01
  header[5] = 0x0c
  header[6] = type
  header[7] = seq & 0xff
  return Buffer.concat([header, payload])
}

function buildRawResponse(code, requestId, body = Buffer.alloc(0)) {
  const raw = Buffer.alloc(9 + body.length)
  raw.writeUInt16LE(code, 0)
  raw[2] = 0x03
  raw.writeUInt16LE(requestId, 3)
  raw.writeUInt32LE(0x8000, 5)
  body.copy(raw, 9)

  const length = Buffer.alloc(4)
  length.writeUInt32LE(raw.length, 0)
  return Buffer.concat([length, raw, Buffer.alloc(4)])
}

function readVarint(buffer, start) {
  let value = 0
  let shift = 0
  let offset = start
  while (offset < buffer.length && shift <= 28) {
    const byte = buffer[offset]
    offset += 1
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7
  }
  return null
}

function parseDeletePaths(body) {
  const paths = []
  let offset = 0
  while (offset < body.length) {
    const tag = readVarint(body, offset)
    if (!tag || tag.value !== 0x0a) break
    const length = readVarint(body, tag.offset)
    if (!length || length.offset + length.value > body.length) break
    paths.push(body.subarray(length.offset, length.offset + length.value).toString('utf8'))
    offset = length.offset + length.value
  }
  return paths
}

function parseUcd2Frames(buffer) {
  const frames = []
  let rest = buffer
  while (rest.length >= 8) {
    const start = rest.indexOf(UCD2_MAGIC)
    if (start < 0) return { frames, rest: Buffer.alloc(0) }
    if (start > 0) rest = rest.subarray(start)
    if (rest.length < 8) break

    const type = rest[6]
    const frameLen = type === UCD2_STREAM
      ? 16
      : type === UCD2_FILE && rest.length >= 12
        ? 12 + rest.readUInt32LE(8) + 4
        : 0
    if (frameLen === 0) {
      rest = rest.subarray(8)
      continue
    }
    if (rest.length < frameLen) break
    frames.push(rest.subarray(0, frameLen))
    rest = rest.subarray(frameLen)
  }
  return { frames, rest }
}

function fileListRequest(body) {
  const request = { storagePath: CAMERA_PATH, offset: 0, limit: 50 }
  let offset = 0
  while (offset < body.length) {
    const tag = readVarint(body, offset)
    if (!tag) break
    offset = tag.offset
    const field = tag.value >> 3
    const wireType = tag.value & 0x07
    if (wireType === 0) {
      const value = readVarint(body, offset)
      if (!value) break
      offset = value.offset
      if (field === 2) request.offset = value.value
      if (field === 3) request.limit = value.value
      if (field === 4) request.storagePath = value.value === 3 ? '/DCIM/' : CAMERA_PATH
      continue
    }
    if (wireType === 2) {
      const length = readVarint(body, offset)
      if (!length) break
      offset = length.offset + length.value
      continue
    }
    break
  }
  return request
}

async function fileListResponseBody({ storagePath, offset, limit }) {
  // 与 HTTP Mock 保持一致：默认存储提供素材，另一存储保持为空。
  if (storagePath !== CAMERA_PATH) return Buffer.alloc(0)
  const files = await walk(rootDir)
  const cameraPaths = files
    .map((filePath) => `${storagePath}${path.relative(rootDir, filePath).split(path.sep).join('/')}`)
    .filter((cameraPath) => !deletedCameraPaths.has(path.posix.normalize(cameraPath)))
    .sort()
    .slice(offset, offset + limit)
  return Buffer.from(`${cameraPaths.join('\0')}\0`, 'utf8')
}

async function responseForUcd2Frame(frame) {
  const type = frame[6]
  const seq = frame[7]
  if (type !== UCD2_FILE || frame.length < 25) return null
  const rawLen = frame.readUInt32LE(8)
  const rawOffset = 12
  if (rawLen < 9 || frame.length < rawOffset + rawLen) return null
  const raw = frame.subarray(rawOffset, rawOffset + rawLen)
  const code = raw.readUInt16LE(0)
  const requestId = raw.readUInt16LE(3)
  if (code === 13) {
    const body = await fileListResponseBody(fileListRequest(raw.subarray(9)))
    return buildUcd2(UCD2_FILE, seq, buildRawResponse(200, requestId, body))
  }
  if (code === 12) {
    for (const cameraPath of parseDeletePaths(raw.subarray(9))) {
      deletedCameraPaths.add(path.posix.normalize(cameraPath))
    }
  }
  return buildUcd2(UCD2_FILE, seq, buildRawResponse(code, requestId))
}

function extensionOf(name) {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

function isPreviewCacheDirName(name) {
  return name === 'cache_previews'
}

function isGeneratedLivePreviewName(name) {
  return name.toLowerCase().endsWith('.live.mp4')
}

function isMediaFile(name) {
  if (isGeneratedLivePreviewName(name)) return false
  const extension = extensionOf(name)
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension)
}

function parseTimestamp(name) {
  const match = name.match(/(?:VID|LRV|IMG|LIV|PIC|PANO)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatIndexDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date).replaceAll(' ', '-')
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`
  return String(bytes)
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function contentType(name) {
  const ext = extensionOf(name)
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (['mp4', 'mov', 'lrv'].includes(ext)) return 'video/mp4'
  return 'application/octet-stream'
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (isPreviewCacheDirName(entry.name)) continue
      files.push(...await walk(entryPath))
    } else if (entry.isFile() && isMediaFile(entry.name)) {
      files.push(entryPath)
    }
  }
  return files
}

function cameraDirFor(relative) {
  const [first] = relative.split('/')
  return CAMERA_DIR_NAMES.includes(first) ? first : null
}

function hasExplicitCameraDir(cameraDir) {
  if (!cameraDir) return false
  const dirPath = path.join(rootDir, cameraDir)
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function stripCameraDir(relative) {
  const normalized = relative.replace(/^\/+/, '')
  const dir = cameraDirFor(normalized)
  return dir && !hasExplicitCameraDir(dir) ? normalized.slice(dir.length).replace(/^\/+/, '') : normalized
}

function storagePathForRequest(pathname) {
  const matchedStorage = STORAGE_PATHS.find((sp) => pathname.startsWith(sp))
  if (matchedStorage) return matchedStorage
  const firstSegment = pathname.replace(/^\/+/, '').split('/')[0]
  return CAMERA_DIR_NAMES.includes(firstSegment) ? '/' : null
}

function requestRelativePath(pathname, matchedStorage) {
  const decodedPath = decodeURIComponent(pathname)
  return matchedStorage === '/'
    ? decodedPath.slice(1)
    : decodedPath.slice(matchedStorage.length)
}

function isIndexRequest(pathname, matchedStorage) {
  const relative = requestRelativePath(pathname, matchedStorage).replace(/^\/+|\/+$/g, '')
  return relative === '' || CAMERA_DIR_NAMES.includes(relative)
}

async function filesForCameraDir(cameraDir) {
  const explicitDir = cameraDir ? path.join(rootDir, cameraDir) : rootDir
  try {
    const stats = await stat(explicitDir)
    if (stats.isDirectory()) return walk(explicitDir)
  } catch {}
  // 没有显式子目录时，将 root 下的文件分片分配给各 Camera 目录，避免重复
  const allFiles = await walk(rootDir)
  const dirIndex = cameraDir ? CAMERA_DIR_NAMES.indexOf(cameraDir) : 0
  if (dirIndex < 0) return allFiles
  const chunkSize = Math.max(1, Math.ceil(allFiles.length / CAMERA_DIR_NAMES.length))
  return allFiles.slice(dirIndex * chunkSize, (dirIndex + 1) * chunkSize)
}

function hrefForIndex(relative, cameraDir) {
  const normalized = relative.split(path.sep).join('/')
  return cameraDir ? encodeURI(normalized) : encodeURI(normalized)
}

async function indexHtml(requestPath = CAMERA_PATH) {
  const normalizedPath = requestPath.endsWith('/') ? requestPath : `${requestPath}/`
  const cameraDir = CAMERA_DIR_NAMES.find((name) => normalizedPath.endsWith(`/${name}/`)) ?? null
  const rows = []
  if (!cameraDir) {
    const now = new Date()
    for (const dir of CAMERA_DIR_NAMES) {
      rows.push({
        time: Number.MAX_SAFE_INTEGER - rows.length,
        html: `<a href="${dir}/">${dir}/</a> ${formatIndexDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} -`,
      })
    }
    rows.sort((a, b) => b.time - a.time)
    return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Luna Mock</title></head>
<body>
<h1>Index of ${escapeHtml(normalizedPath)}</h1>
<pre>
<a href="../">../</a>
${rows.map((row) => row.html).join('\n')}
</pre>
</body>
</html>
`
  }
  const files = await filesForCameraDir(cameraDir)
  for (const filePath of files) {
    const stats = await stat(filePath)
    const name = path.basename(filePath)
    const baseDir = cameraDir && filePath.startsWith(path.join(rootDir, cameraDir) + path.sep)
      ? path.join(rootDir, cameraDir)
      : rootDir
    const relative = path.relative(baseDir, filePath).split(path.sep).join('/')
    const date = parseTimestamp(name) || stats.mtime
    const href = hrefForIndex(relative, cameraDir)
    const cameraPath = decodeURIComponent(new URL(href, `http://luna.mock${normalizedPath}`).pathname)
    if (deletedCameraPaths.has(path.posix.normalize(cameraPath))) continue
    rows.push({
      time: date.getTime(),
      html: `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a> ${formatIndexDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())} ${formatSize(stats.size)}`,
    })
  }
  rows.sort((a, b) => b.time - a.time)
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Luna Mock</title></head>
<body>
<h1>Index of ${escapeHtml(normalizedPath)}</h1>
<pre>
<a href="../">../</a>
${rows.map((row) => row.html).join('\n')}
</pre>
</body>
</html>
`
}

function filePathForRequest(url) {
  const matchedStorage = storagePathForRequest(url.pathname)
  if (!matchedStorage) return null
  const relative = stripCameraDir(requestRelativePath(url.pathname, matchedStorage))
  if (!relative) return null
  const filePath = path.resolve(rootDir, relative)
  if (!filePath.startsWith(`${rootDir}${path.sep}`) && filePath !== rootDir) return null
  return filePath
}

function rangeFor(request, size) {
  const range = request.headers.range
  if (!range) return { start: 0, end: size - 1, partial: false }
  const match = String(range).match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null
  let start = match[1] === '' ? 0 : Number(match[1])
  let end = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  end = Math.min(end, size - 1)
  return { start, end, partial: true }
}

function sendThrottledFile(request, response, filePath, stats) {
  const selectedRange = rangeFor(request, stats.size)
  if (!selectedRange) {
    response.writeHead(416, { 'Content-Range': `bytes */${stats.size}` })
    response.end()
    return
  }

  const { start, end, partial } = selectedRange
  const length = end - start + 1
  response.writeHead(partial ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': length,
    'Content-Type': contentType(filePath),
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${stats.size}` } : {}),
  })

  const stream = createReadStream(filePath, { start, end, highWaterMark: 256 * 1024 })
  let sent = 0
  let pendingWrites = 0
  let sourceEnded = false
  const started = Date.now()

  const finishIfReady = () => {
    if (sourceEnded && pendingWrites === 0 && !response.destroyed) {
      response.end()
    }
  }

  stream.on('data', (chunk) => {
    stream.pause()
    sent += chunk.length
    pendingWrites += 1
    const expectedElapsed = (sent / Math.max(rateBps, 1)) * 1000
    const actualElapsed = Date.now() - started
    const throttleDelay = Math.max(0, expectedElapsed - actualElapsed)
    setTimeout(() => {
      if (!response.destroyed) {
        response.write(chunk, () => {
          pendingWrites -= 1
          if (!sourceEnded && !stream.destroyed) stream.resume()
          finishIfReady()
        })
      } else {
        pendingWrites -= 1
        finishIfReady()
      }
    }, throttleDelay)
  })
  stream.on('end', () => {
    sourceEnded = true
    finishIfReady()
  })
  stream.on('error', (error) => {
    console.error('[mock:http] stream error', error)
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
  response.on('close', () => stream.destroy())
}

const httpServer = createHttpServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${httpPort}`}`)
    const matchedStorage = storagePathForRequest(url.pathname)
    if (!matchedStorage) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    if (!authGate.isAuthorized()) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Luna mock requires a fresh TCP auth session before HTTP access.\n')
      return
    }

    if (deletedCameraPaths.has(path.posix.normalize(decodeURIComponent(url.pathname)))) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    if (isIndexRequest(url.pathname, matchedStorage)) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      // 非默认存储路径返回空目录，避免素材重复
      response.end(matchedStorage === CAMERA_PATH || matchedStorage === '/' ? await indexHtml(url.pathname) : '<!doctype html><html><body><pre></pre></body></html>')
      return
    }

    const filePath = filePathForRequest(url)
    if (!filePath) {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    const stats = await stat(filePath)
    if (!stats.isFile()) {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType(filePath),
      })
      response.end()
      return
    }
    sendThrottledFile(request, response, filePath, stats)
  } catch (error) {
    console.error('[mock:http] request failed', error)
    if (!response.headersSent) response.writeHead(500)
    response.end('Internal server error')
  }
})

const tcpServer = createTcpServer((socket) => {
  let received = Buffer.alloc(0)
  socket.setTimeout(60_000)
  socket.on('data', async (chunk) => {
    received = Buffer.concat([received, chunk])

    if (received.length <= EXPECTED_AUTH.length && received.equals(EXPECTED_AUTH.subarray(0, received.length))) {
      if (received.length < EXPECTED_AUTH.length) return
      authGate.authorize(socket)
      socket.write(Buffer.from([0x55, 0x43, 0x44, 0x32, 0x00]))
      received = Buffer.alloc(0)
      return
    }

    const parsed = parseUcd2Frames(received)
    received = parsed.rest
    if (parsed.frames.length === 0) return

    for (const frame of parsed.frames) {
      if (isStreamHandshake(frame)) authGate.authorize(socket)
      const response = await responseForUcd2Frame(frame)
      if (response) socket.write(response)
    }
  })
  socket.on('timeout', () => socket.destroy())
  socket.on('close', () => authGate.revoke(socket))
  socket.on('error', () => authGate.revoke(socket))
})

async function main() {
  await stat(rootDir)
  await Promise.all([
    listen(httpServer, httpPort, host),
    listen(tcpServer, tcpPort, host),
  ])

  console.log('[luna-mock] root:', rootDir)
  console.log('[luna-mock] http:', `http://${host}:${httpPort}${CAMERA_PATH}`)
  console.log('[luna-mock] tcp:', `${host}:${tcpPort}`)
  console.log('[luna-mock] rate:', `${Math.round(rateBps / 1024 / 1024)} MB/s`)
  console.log('[luna-mock] storages:', STORAGE_PATHS.join(', '))
  console.log('[luna-mock] app cameraHost:', `${host}:${httpPort}`)
}

function listen(server, port, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, address)
  })
}

main().catch((error) => {
  console.error('[luna-mock] failed to start:', error)
  process.exitCode = 1
})

function shutdown() {
  httpServer.close()
  tcpServer.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
