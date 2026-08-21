import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'

const REMOTION_VERSION = '4.0.484'
const SHOTCRAFT_COMPOSITION_ID = 'shotcraft-promo'

const require = createRequire(import.meta.url)
const RESULT_PREFIX = 'LUNA_REMOTION_RESULT:'
const EVENT_PREFIX = 'LUNA_REMOTION_EVENT:'

function emit(event) {
  process.stdout.write(`${EVENT_PREFIX}${JSON.stringify(event)}\n`)
}

function outputResult(value) {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(value)}\n`)
}

function mediaMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
  }[extension] ?? 'application/octet-stream'
}

async function createMediaServer(media) {
  const mediaById = new Map(media.map((item) => [item.id, item]))
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!requestUrl.pathname.startsWith('/media/')) {
        response.writeHead(404).end()
        return
      }
      const mediaId = decodeURIComponent(requestUrl.pathname.slice('/media/'.length))
      const item = mediaById.get(mediaId)
      if (!item) {
        response.writeHead(404).end()
        return
      }
      const fileStats = await stat(item.path)
      const commonHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Type': mediaMimeType(item.path),
      }
      const range = request.headers.range
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(range)
        if (!match) {
          response.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${fileStats.size}` }).end()
          return
        }
        const start = match[1] === '' ? Math.max(0, fileStats.size - Number(match[2])) : Number(match[1])
        const end = match[2] === '' ? fileStats.size - 1 : Number(match[2])
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileStats.size) {
          response.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${fileStats.size}` }).end()
          return
        }
        const boundedEnd = Math.min(end, fileStats.size - 1)
        response.writeHead(206, {
          ...commonHeaders,
          'Content-Length': boundedEnd - start + 1,
          'Content-Range': `bytes ${start}-${boundedEnd}/${fileStats.size}`,
        })
        if (request.method !== 'HEAD') createReadStream(item.path, { start, end: boundedEnd }).pipe(response)
        else response.end()
        return
      }
      response.writeHead(200, { ...commonHeaders, 'Content-Length': fileStats.size })
      if (request.method !== 'HEAD') createReadStream(item.path).pipe(response)
      else response.end()
    } catch {
      if (!response.headersSent) response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start the local Remotion media server')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections?.()
    }),
  }
}

async function readInput() {
  let value = ''
  for await (const chunk of process.stdin) value += chunk.toString('utf8')
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object') throw new TypeError('Remotion worker input must be an object')
  return parsed
}

function remotionPackageVersion() {
  try {
    return require('remotion/package.json').version
  } catch {
    return REMOTION_VERSION
  }
}

async function main() {
  const input = await readInput()
  const cancelState = makeCancelSignal()
  let mediaServer
  let canceled = false
  const cancel = () => {
    canceled = true
    cancelState.cancel()
  }
  process.once('SIGTERM', cancel)
  process.once('SIGINT', cancel)

  emit({ type: 'status', status: 'bundling', progress: 0 })
  const serveUrl = await bundle({
    entryPoint: input.entryPoint,
    rootDir: input.rootDir,
    outDir: input.bundleDirectory,
    publicDir: null,
    enableCaching: false,
    keyboardShortcutsEnabled: false,
    askAIEnabled: false,
    onProgress: (progress) => emit({ type: 'status', status: 'bundling', progress: progress / 100 }),
  })
  if (canceled) throw new Error('Remotion render canceled')

  try {
    mediaServer = await createMediaServer(input.media ?? [])
  const inputProps = {
    scene: input.scene,
    media: (input.media ?? []).map((item) => ({ ...item, src: `${mediaServer.baseUrl}/media/${encodeURIComponent(item.id)}` })),
    ...(input.props && typeof input.props === 'object' ? input.props : {}),
  }
    const browserOptions = {
      browserExecutable: input.browserExecutable,
      binariesDirectory: input.binariesDirectory,
      chromeMode: 'headless-shell',
      logLevel: 'error',
    }
    const composition = await selectComposition({
      ...browserOptions,
      serveUrl,
      id: input.compositionId ?? SHOTCRAFT_COMPOSITION_ID,
      inputProps,
    })
    emit({ type: 'status', status: 'rendering', progress: 0 })
    await renderMedia({
      ...browserOptions,
      serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      outputLocation: input.outputPath,
      overwrite: true,
      concurrency: 2,
      cancelSignal: cancelState.cancelSignal,
      onProgress: (progress) => emit({ type: 'status', status: 'rendering', progress: progress.progress }),
    })
    if (canceled) throw new Error('Remotion render canceled')
    const bytes = await readFile(input.outputPath)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const manifest = {
      version: 1,
      composition: input.compositionId ?? SHOTCRAFT_COMPOSITION_ID,
      remotionVersion: remotionPackageVersion(),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.clipId ? { clipId: input.clipId } : {}),
      ...(Number.isInteger(input.sourceRevision) ? { sourceRevision: input.sourceRevision } : {}),
      ...(typeof input.sourceHash === 'string' ? { sourceHash: input.sourceHash } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      scene: input.scene,
      inputMediaIds: (input.media ?? []).map((item) => item.id),
      output: { path: input.outputPath, bytes: bytes.byteLength, sha256, mimeType: 'video/mp4' },
    }
    await writeFile(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    outputResult({ fileSize: bytes.byteLength, sha256, remotionVersion: remotionPackageVersion() })
  } finally {
    await mediaServer?.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
