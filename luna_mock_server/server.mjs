#!/usr/bin/env node
import { createReadStream, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import path from 'node:path'

const DEVICE_CONFIG = JSON.parse(readFileSync(new URL('../electron/deviceConfigs/luna-ultra.json', import.meta.url), 'utf-8'))
const STORAGE_PATHS = DEVICE_CONFIG.storages.map((s) => s.path)
const CAMERA_PATH = STORAGE_PATHS.find((p) => DEVICE_CONFIG.storages[STORAGE_PATHS.indexOf(p)].default) || STORAGE_PATHS[0] || '/'
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'dng', 'insp', 'webp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'lrv'])
const AUTH_PAYLOADS = [
  Buffer.from([
    0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x05, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x37, 0x05, 0x47, 0x7c,
  ]),
  Buffer.from([
    0x55, 0x43, 0x44, 0x32, 0x01, 0x0c, 0x04, 0x10, 0x0f, 0x00, 0x00, 0x00, 0x08, 0x00, 0x02, 0x01,
    0x00, 0x00, 0x80, 0x00, 0x00, 0x08, 0x30, 0x08, 0x0f, 0x08, 0x0b, 0x7c, 0x00, 0x8e, 0x7c,
  ]),
]

const EXPECTED_AUTH = Buffer.concat(AUTH_PAYLOADS)
const AUTH_TTL_MS = 15_000
const DEFAULT_MOCK = DEVICE_CONFIG.mock

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

let authorizedUntil = 0

function isAuthorized() {
  return Date.now() <= authorizedUntil
}

function authorize() {
  authorizedUntil = Date.now() + AUTH_TTL_MS
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

async function indexHtml() {
  const files = await walk(rootDir)
  const rows = []
  for (const filePath of files) {
    const stats = await stat(filePath)
    const name = path.basename(filePath)
    const relative = path.relative(rootDir, filePath).split(path.sep).join('/')
    const date = parseTimestamp(name) || stats.mtime
    const href = encodeURI(relative)
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
<h1>Index of ${CAMERA_PATH}</h1>
<pre>
<a href="../">../</a>
${rows.map((row) => row.html).join('\n')}
</pre>
</body>
</html>
`
}

function filePathForRequest(url) {
  const decodedPath = decodeURIComponent(url.pathname)
  const matchedStorage = STORAGE_PATHS.find((sp) => decodedPath.startsWith(sp))
  if (!matchedStorage) return null
  const relative = decodedPath.slice(matchedStorage.length)
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
    const matchedStorage = STORAGE_PATHS.find((sp) => url.pathname.startsWith(sp))
    if (!matchedStorage) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    if (!isAuthorized()) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Luna mock requires a fresh TCP auth session before HTTP access.\n')
      return
    }

    if (url.pathname === matchedStorage) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      // 非默认存储路径返回空目录，避免素材重复
      response.end(matchedStorage === CAMERA_PATH ? await indexHtml() : '<!doctype html><html><body><pre></pre></body></html>')
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
    sendThrottledFile(request, response, filePath, stats)
  } catch (error) {
    console.error('[mock:http] request failed', error)
    if (!response.headersSent) response.writeHead(500)
    response.end('Internal server error')
  }
})

const tcpServer = createTcpServer((socket) => {
  let received = Buffer.alloc(0)
  socket.setTimeout(2000)
  socket.on('data', (chunk) => {
    received = Buffer.concat([received, chunk])
    const expectedPrefix = EXPECTED_AUTH.subarray(0, received.length)
    if (received.length > EXPECTED_AUTH.length || !received.equals(expectedPrefix)) {
      socket.destroy()
      return
    }
    if (received.length === EXPECTED_AUTH.length) {
      authorize()
      socket.write(Buffer.from([0x55, 0x43, 0x44, 0x32, 0x00]))
      received = Buffer.alloc(0)
    }
  })
  socket.on('timeout', () => socket.destroy())
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

process.on('SIGINT', () => {
  httpServer.close()
  tcpServer.close()
  process.exit(0)
})
