import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { basename, extname, join, parse } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { nativeImage } from 'electron'
import QRCode from 'qrcode'

import { listDownloadedFiles } from '../downloadedLibraryService'
import { getTasks } from '../../export/exportTaskService'
import { getLocalResourcesDir, getSettings, saveSettings } from '../../storage/fileService'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import {
  startLocalMediaShareServer,
  type RunningLocalMediaShareServer,
  type ShareResourceRecord,
} from './localMediaShareServer'
import type { LocalMediaShareFileRoot } from './localMediaShareFiles'
import type {
  LocalMediaShareNetwork,
  LocalMediaShareEntry,
  LocalMediaShareSource,
  LocalMediaShareStatus,
} from '../../../src/shared/types/localMediaShare'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff', '.heic', '.heif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mts', '.insv', '.wmv', '.3gp', '.lrv', '.lrf', '.xrf'])
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mts': 'video/mp2t',
  '.insv': 'video/mp4',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp',
  '.lrv': 'video/mp4',
  '.lrf': 'video/mp4',
  '.xrf': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.dng': 'image/x-adobe-dng',
}

let runningServer: RunningLocalMediaShareServer | null = null
let currentStatus: LocalMediaShareStatus = stoppedStatus()
let networkTimer: ReturnType<typeof setInterval> | null = null
const thumbnailCache = new Map<string, Buffer>()
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024

function stoppedStatus(): LocalMediaShareStatus {
  return {
    running: false,
    address: null,
    port: null,
    url: null,
    qrDataUrl: null,
    localCount: 0,
    exportCount: 0,
    customCount: 0,
    sharedFileCount: 0,
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
  sourceLabel?: string,
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
      sourceLabel,
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

interface CleanedSharePaths {
  directories: string[]
  files: string[]
}

async function existingDirectory(filePath: string): Promise<string | null> {
  try {
    const resolvedPath = await realpath(filePath)
    return (await stat(resolvedPath)).isDirectory() ? resolvedPath : null
  } catch {
    return null
  }
}

async function existingFile(filePath: string): Promise<string | null> {
  try {
    const resolvedPath = await realpath(filePath)
    return (await stat(resolvedPath)).isFile() ? resolvedPath : null
  } catch {
    return null
  }
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function cleanPersistedSharePaths(): Promise<CleanedSharePaths> {
  const settings = await getSettings()
  const directoryCandidates = [...new Set((settings.localMediaShareDirectories ?? []).map((value) => value.trim()).filter(Boolean))]
  const fileCandidates = [...new Set((settings.localMediaShareFiles ?? []).map((value) => value.trim()).filter(Boolean))]
  const [directories, files] = await Promise.all([
    Promise.all(directoryCandidates.map(existingDirectory)).then((values) => values.filter((value): value is string => value !== null)),
    Promise.all(fileCandidates.map(existingFile)).then((values) => values.filter((value): value is string => value !== null)),
  ])
  if (!samePaths(directoryCandidates, directories) || !samePaths(fileCandidates, files)) {
    await saveSettings({ localMediaShareDirectories: directories, localMediaShareFiles: files })
  }
  return { directories, files }
}

function sharedDirectoryRootId(directory: string): string {
  return `directory-${createHash('sha256').update(directory).digest('base64url').slice(0, 24)}`
}

async function sharedFileRoots(): Promise<LocalMediaShareFileRoot[]> {
  const { directories, files } = await cleanPersistedSharePaths()
  if (currentStatus.running) currentStatus.sharedFileCount = files.length
  const roots: LocalMediaShareFileRoot[] = directories.map((directory) => ({
    id: sharedDirectoryRootId(directory),
    name: basename(directory) || directory,
    directoryPath: directory,
  }))
  if (files.length > 0) roots.push({ id: 'shared-files', name: '拖入的文件', filePaths: files })
  return roots
}

export async function getLocalMediaShareDirectories(): Promise<string[]> {
  return (await cleanPersistedSharePaths()).directories
}

export async function getLocalMediaShareEntries(): Promise<LocalMediaShareEntry[]> {
  const { directories, files } = await cleanPersistedSharePaths()
  return [
    ...directories.map((path) => ({ kind: 'directory' as const, path, name: basename(path) || path })),
    ...files.map((path) => ({ kind: 'file' as const, path, name: basename(path) || path })),
  ]
}

export async function addSharedFiles(filePaths: string[]): Promise<LocalMediaShareStatus> {
  const cleaned = await cleanPersistedSharePaths()
  const candidates = [...new Set(filePaths.map((filePath) => filePath.trim()).filter(Boolean))]
  const validFiles = await Promise.all(candidates.map(existingFile))
  const nextFiles = [...new Set([
    ...cleaned.files,
    ...validFiles.filter((filePath): filePath is string => filePath !== null),
  ])]
  await saveSettings({ localMediaShareFiles: nextFiles })
  currentStatus.sharedFileCount = nextFiles.length
  return getLocalMediaShareStatus()
}

export async function removeSharedFile(filePath: string): Promise<LocalMediaShareStatus> {
  const cleaned = await cleanPersistedSharePaths()
  const nextFiles = cleaned.files.filter((candidate) => candidate !== filePath)
  await saveSettings({ localMediaShareFiles: nextFiles })
  currentStatus.sharedFileCount = nextFiles.length
  return getLocalMediaShareStatus()
}

function safeUploadName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/')
  const cleaned = [...basename(normalized)].map((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? '_' : character
  }).join('').trim()
  return cleaned || '上传素材'
}

async function moveUploadWithoutOverwrite(temporaryPath: string, directory: string, fileName: string): Promise<string> {
  const parsed = parse(fileName)
  for (let suffix = 1; suffix < 1_000_000; suffix += 1) {
    const candidate = join(directory, suffix === 1 ? fileName : `${parsed.name} (${suffix - 1})${parsed.ext}`)
    try {
      await link(temporaryPath, candidate)
      await rm(temporaryPath, { force: true })
      return candidate
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  throw new Error('无法为上传文件分配文件名')
}

async function uploadToLocalResources(request: IncomingMessage, fileName: string): Promise<ShareResourceRecord> {
  const normalizedName = safeUploadName(fileName)
  if (previewKind(normalizedName) === 'download-only') throw new Error('只支持上传图片和视频')
  const settings = await getSettings()
  const directory = getLocalResourcesDir(settings)
  await mkdir(directory, { recursive: true })
  const lengthHeader = request.headers['content-length']
  const declaredLength = lengthHeader ? Number(lengthHeader) : null
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_UPLOAD_BYTES)) {
    throw new Error('上传文件过大')
  }

  const temporaryPath = join(directory, `.luna-upload-${randomUUID()}.tmp`)
  let receivedBytes = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_UPLOAD_BYTES) {
        callback(new Error('上传文件过大'))
        return
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      request as unknown as NodeJS.ReadableStream,
      limit as unknown as NodeJS.ReadWriteStream,
      createWriteStream(temporaryPath, { flags: 'wx' }) as unknown as NodeJS.WritableStream,
    )
    const destination = await moveUploadWithoutOverwrite(temporaryPath, directory, normalizedName)
    const resource = await createResource('local', destination)
    if (!resource || resource.previewKind === 'download-only') {
      await rm(destination, { force: true })
      throw new Error('只支持上传图片和视频')
    }
    currentStatus.localCount += 1
    logMainInfo('[手机访问] 手机上传完成', { fileName: resource.name, destination })
    return resource
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
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
  const sharePaths = await cleanPersistedSharePaths()
  const networks = listLocalMediaShareNetworks()
  const network = networks[0]
  if (!network) throw new Error('没有找到可用的局域网，请先连接 Wi-Fi 或有线网络')

  const [locals, exports] = await Promise.all([localResources(), exportResources()])
  const deduplicated = new Map<string, ShareResourceRecord>()
  for (const resource of [...locals, ...exports]) deduplicated.set(`${resource.source}:${resource.absolutePath}`, resource)
  const resources = [...deduplicated.values()]
  const localCount = resources.filter((resource) => resource.source === 'local').length
  const exportCount = resources.filter((resource) => resource.source === 'export').length
  const customCount = 0

  const assetsDir = join(process.env.VITE_PUBLIC ?? '', 'local-share')
  const server = await startLocalMediaShareServer({
    address: network.address,
    assetsDir,
    resources,
    thumbnail: thumbnailFor,
    upload: uploadToLocalResources,
    sharedFileRoots,
  })
  try {
    const qrDataUrl = await QRCode.toDataURL(server.url, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
    runningServer = server
    currentStatus = {
      running: true,
      address: server.address,
      port: server.port,
      url: server.url,
      qrDataUrl,
      localCount,
      exportCount,
      customCount,
      sharedFileCount: sharePaths.files.length,
      startedAt: Date.now(),
    }
    networkTimer = setInterval(() => {
      if (!listLocalMediaShareNetworks().some((network) => network.address === server.address)) {
        logMainWarn('[手机访问] 网络地址已变化，停止当前分享')
        void stopLocalMediaShare()
      }
    }, 5_000)
    networkTimer.unref?.()
    logMainInfo('[手机访问] 分享已启动', { address: server.address, port: server.port, localCount, exportCount, customCount, sharedFileCount: sharePaths.files.length })
    return getLocalMediaShareStatus()
  } catch (error) {
    await server.stop()
    throw error
  }
}
