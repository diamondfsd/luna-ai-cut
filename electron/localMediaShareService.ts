import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { basename, extname, join } from 'node:path'

import { nativeImage } from 'electron'
import QRCode from 'qrcode'

import { listDownloadedFiles } from './downloadedLibraryService'
import { getTasks } from './exportTaskService'
import { getLocalResourcesDir, getSettings } from './fileService'
import { logMainInfo, logMainWarn } from './loggerService'
import { startLocalMediaShareServer, type RunningLocalMediaShareServer, type ShareResourceRecord } from './localMediaShareServer'
import type {
  LocalMediaShareNetwork,
  LocalMediaShareSource,
  LocalMediaShareStatus,
} from '../src/shared/types/localMediaShare'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mts', '.insv'])
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mts': 'video/mp2t',
  '.insv': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.dng': 'image/x-adobe-dng',
}

let runningServer: RunningLocalMediaShareServer | null = null
let currentStatus: LocalMediaShareStatus = stoppedStatus()
let networkTimer: ReturnType<typeof setInterval> | null = null
const thumbnailCache = new Map<string, Buffer>()

function stoppedStatus(): LocalMediaShareStatus {
  return {
    running: false,
    address: null,
    port: null,
    url: null,
    qrDataUrl: null,
    localCount: 0,
    exportCount: 0,
    startedAt: null,
  }
}

function previewKind(filePath: string): ShareResourceRecord['previewKind'] {
  const extension = extname(filePath).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return 'download-only'
}

function resourceId(source: LocalMediaShareSource, filePath: string): string {
  return createHash('sha256').update(`${source}\0${filePath}`).digest('base64url').slice(0, 22)
}

async function createResource(
  source: LocalMediaShareSource,
  filePath: string,
  createdAt?: number | null,
): Promise<ShareResourceRecord | null> {
  try {
    const resolvedPath = await realpath(filePath)
    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile()) return null
    const extension = extname(resolvedPath).toLowerCase()
    const fallbackTime = fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : fileStat.mtimeMs
    return {
      id: resourceId(source, resolvedPath),
      source,
      absolutePath: resolvedPath,
      name: basename(filePath),
      mimeType: MIME_TYPES[extension] ?? 'application/octet-stream',
      size: fileStat.size,
      createdAt: createdAt && Number.isFinite(createdAt) ? createdAt : fallbackTime,
      previewKind: previewKind(resolvedPath),
    }
  } catch {
    return null
  }
}

async function localResources(): Promise<ShareResourceRecord[]> {
  const settings = await getSettings()
  const files = await listDownloadedFiles(getLocalResourcesDir(settings))
  const resources = await Promise.all(files.map((file) => createResource('local', file.localPath ?? file.downloadFilePath ?? '')))
  return resources.filter((resource): resource is ShareResourceRecord => resource !== null)
}

async function exportResources(): Promise<ShareResourceRecord[]> {
  const tasks = await getTasks()
  const candidates = tasks.flatMap((task) => task.items
    .filter((item) => item.status === 'done' && item.destinationPath)
    .map((item) => ({ path: item.destinationPath!, createdAt: item.endTime ?? task.endTime ?? task.startTime })))
  const resources = await Promise.all(candidates.map((candidate) => createResource('export', candidate.path, candidate.createdAt)))
  return resources.filter((resource): resource is ShareResourceRecord => resource !== null)
}

export function listLocalMediaShareNetworks(): LocalMediaShareNetwork[] {
  const result: LocalMediaShareNetwork[] = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4' || entry.address.startsWith('169.254.')) continue
      result.push({ id: `${name}:${entry.address}`, name, address: entry.address })
    }
  }
  const preference = (network: LocalMediaShareNetwork): number => {
    if (/^(bridge|docker|veth|vethernet|vmnet|vbox|utun|awdl|llw|tailscale|zt)/i.test(network.name)) return 4
    if (/wi-?fi|wlan|airport|en0/i.test(network.name)) return 0
    if (/ethernet|^eth\d*$|^en\d+$/i.test(network.name)) return 1
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(network.address)) return 2
    return 3
  }
  return result.sort((left, right) => (
    preference(left) - preference(right)
    || left.name.localeCompare(right.name)
    || left.address.localeCompare(right.address)
  ))
}

async function thumbnailFor(resource: ShareResourceRecord): Promise<Buffer | null> {
  const cached = thumbnailCache.get(resource.id)
  if (cached) return cached
  try {
    const image = await nativeImage.createThumbnailFromPath(resource.absolutePath, { width: 480, height: 360 })
    if (image.isEmpty()) return null
    const bytes = image.toJPEG(82)
    if (thumbnailCache.size >= 120) thumbnailCache.delete(thumbnailCache.keys().next().value as string)
    thumbnailCache.set(resource.id, bytes)
    return bytes
  } catch {
    return null
  }
}

export function getLocalMediaShareStatus(): LocalMediaShareStatus {
  return { ...currentStatus }
}

export async function stopLocalMediaShare(): Promise<LocalMediaShareStatus> {
  if (networkTimer) clearInterval(networkTimer)
  networkTimer = null
  const server = runningServer
  runningServer = null
  currentStatus = stoppedStatus()
  thumbnailCache.clear()
  if (server) {
    await server.stop()
    logMainInfo('[手机访问] 分享已停止')
  }
  return getLocalMediaShareStatus()
}

export async function startLocalMediaShare(): Promise<LocalMediaShareStatus> {
  await stopLocalMediaShare()
  const networks = listLocalMediaShareNetworks()
  const network = networks[0]
  if (!network) throw new Error('没有找到可用的局域网，请先连接 Wi-Fi 或有线网络')

  const sourceSet = new Set<LocalMediaShareSource>(['local', 'export'])
  const [locals, exports] = await Promise.all([
    sourceSet.has('local') ? localResources() : Promise.resolve([]),
    sourceSet.has('export') ? exportResources() : Promise.resolve([]),
  ])
  const deduplicated = new Map<string, ShareResourceRecord>()
  for (const resource of [...locals, ...exports]) deduplicated.set(`${resource.source}:${resource.absolutePath}`, resource)
  const resources = [...deduplicated.values()]

  const assetsDir = join(process.env.VITE_PUBLIC ?? '', 'local-share')
  const server = await startLocalMediaShareServer({ address: network.address, assetsDir, resources, thumbnail: thumbnailFor })
  try {
    const qrDataUrl = await QRCode.toDataURL(server.url, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
    runningServer = server
    currentStatus = {
      running: true,
      address: server.address,
      port: server.port,
      url: server.url,
      qrDataUrl,
      localCount: locals.length,
      exportCount: exports.length,
      startedAt: Date.now(),
    }
    networkTimer = setInterval(() => {
      if (!listLocalMediaShareNetworks().some((network) => network.address === server.address)) {
        logMainWarn('[手机访问] 网络地址已变化，停止当前分享')
        void stopLocalMediaShare()
      }
    }, 5_000)
    networkTimer.unref?.()
    logMainInfo('[手机访问] 分享已启动', { address: server.address, port: server.port, localCount: locals.length, exportCount: exports.length })
    return getLocalMediaShareStatus()
  } catch (error) {
    await server.stop()
    throw error
  }
}
