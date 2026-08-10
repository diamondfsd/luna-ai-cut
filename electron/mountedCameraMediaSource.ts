import { dialog } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { lunaMediaAdapter } from './deviceMedia'
import { deviceDefinitionFor } from './deviceDefaults'
import { labelsFor } from './filePathUtils'
import { logMainInfo, logMainWarn } from './loggerService'
import type {
  CameraDeleteResult,
  CameraMediaSourceCapabilities,
  CameraMediaSourceStatus,
  LunaFile,
  MountedCameraVolume,
} from '../src/shared/types'

export const MOUNTED_CAMERA_CAPABILITIES: CameraMediaSourceCapabilities = {
  list: true,
  preview: true,
  copyToLocal: true,
  create: false,
  update: false,
  delete: true,
  watch: true,
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`
  return String(bytes)
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

async function mediaRootsFor(selectedPath: string): Promise<string[]> {
  const root = await fs.realpath(selectedPath)
  const candidates = path.basename(root).toLowerCase() === 'dcim'
    ? [root]
    : [
        path.join(root, 'DCIM'),
        path.join(root, 'dcim'),
        path.join(root, 'storage_internal', 'DCIM'),
        path.join(root, 'storage_internal', 'dcim'),
      ]
  const roots: string[] = []
  for (const candidate of candidates) {
    if (await directoryExists(candidate)) roots.push(await fs.realpath(candidate))
  }
  return [...new Set(roots)]
}

async function walkMediaFiles(dir: string, limit = Number.POSITIVE_INFINITY, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  const result: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (result.length >= limit) break
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...await walkMediaFiles(entryPath, limit - result.length, depth + 1))
      continue
    }
    if (entry.isFile() && lunaMediaAdapter.mediaKind(entry.name) !== 'unknown') result.push(entryPath)
  }
  return result
}

async function inspectVolume(rootPath: string, requireMedia = true): Promise<MountedCameraVolume | null> {
  try {
    const resolvedRoot = await fs.realpath(rootPath)
    const mediaRoots = await mediaRootsFor(resolvedRoot)
    if (mediaRoots.length === 0) return null
    let mediaCount = 0
    for (const mediaRoot of mediaRoots) {
      mediaCount += (await walkMediaFiles(mediaRoot, 100 - mediaCount)).length
      if (mediaCount >= 100) break
    }
    if (requireMedia && mediaCount === 0) return null
    return {
      id: resolvedRoot,
      label: path.basename(resolvedRoot) || resolvedRoot,
      rootPath: resolvedRoot,
      mediaRoots,
      mediaCount,
    }
  } catch {
    return null
  }
}

async function childDirectories(parent: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(parent, entry.name))
  } catch {
    return []
  }
}

async function platformVolumeRoots(): Promise<string[]> {
  if (process.platform === 'darwin') return childDirectories('/Volumes')
  if (process.platform === 'win32') {
    const roots: string[] = []
    for (let code = 68; code <= 90; code += 1) roots.push(`${String.fromCharCode(code)}:\\`)
    return roots
  }
  const user = process.env.USER || process.env.LOGNAME || ''
  return [
    ...await childDirectories('/media'),
    ...await childDirectories('/mnt'),
    ...(user ? await childDirectories(path.join('/run/media', user)) : []),
  ]
}

export async function detectMountedCameraVolumes(): Promise<MountedCameraVolume[]> {
  const candidates = await platformVolumeRoots()
  const inspected = await Promise.all(candidates.map((candidate) => inspectVolume(candidate, false)))
  const volumes = inspected.filter((volume): volume is MountedCameraVolume => Boolean(volume))
  logMainInfo('[有线相机] 磁盘检测完成', { candidateCount: candidates.length, volumeCount: volumes.length })
  return volumes
}

export async function resolveMountedCameraVolumes(preferredRoot?: string): Promise<MountedCameraVolume[]> {
  const preferred = preferredRoot ? await inspectVolume(preferredRoot, false) : null
  if (preferred) return [preferred]

  const volumes = await detectMountedCameraVolumes()
  const unique = new Map<string, MountedCameraVolume>()
  for (const volume of volumes) {
    const mediaRootsKey = [...volume.mediaRoots].sort().join('\0')
    if (!unique.has(mediaRootsKey)) unique.set(mediaRootsKey, volume)
  }
  return [...unique.values()]
}

export async function chooseMountedCameraVolume(): Promise<MountedCameraVolume | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择相机磁盘或 DCIM 文件夹',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const volume = await inspectVolume(result.filePaths[0])
  if (!volume) throw new Error('所选位置没有找到可识别的相机素材，请选择相机磁盘或 DCIM 文件夹')
  return volume
}

export async function mountedCameraStatus(rootPath: string | undefined, deviceId: string): Promise<CameraMediaSourceStatus> {
  const device = deviceDefinitionFor(deviceId)
  const volume = rootPath ? await inspectVolume(rootPath, false) : null
  if (!volume) {
    return {
      mode: 'wired',
      connected: false,
      sourceId: rootPath || 'mounted-camera',
      host: '',
      httpOk: false,
      controlOk: false,
      message: rootPath ? '相机磁盘已断开或无法读取' : '未检测到相机磁盘',
      deviceId,
      deviceName: device.name,
      capabilities: MOUNTED_CAMERA_CAPABILITIES,
    }
  }
  return {
    mode: 'wired',
    connected: true,
    sourceId: volume.id,
    rootPath: volume.rootPath,
    volumeLabel: volume.label,
    host: volume.rootPath,
    httpOk: true,
    controlOk: true,
    message: `已通过有线连接 ${volume.label}`,
    deviceId,
    deviceName: device.name,
    capabilities: MOUNTED_CAMERA_CAPABILITIES,
  }
}

export function mountedCameraVolumesStatus(
  volumes: MountedCameraVolume[],
  deviceId: string,
): CameraMediaSourceStatus {
  if (volumes.length === 0) return {
    mode: 'wired',
    connected: false,
    sourceId: 'mounted-camera',
    host: '',
    httpOk: false,
    controlOk: false,
    message: '未检测到包含 DCIM 的相机磁盘',
    deviceId,
    deviceName: deviceDefinitionFor(deviceId).name,
    capabilities: MOUNTED_CAMERA_CAPABILITIES,
  }
  if (volumes.length === 1) {
    const volume = volumes[0]
    return {
      mode: 'wired',
      connected: true,
      sourceId: volume.id,
      rootPath: volume.rootPath,
      volumeLabel: volume.label,
      host: volume.rootPath,
      httpOk: true,
      controlOk: true,
      message: `已通过有线连接 ${volume.label}`,
      deviceId,
      deviceName: deviceDefinitionFor(deviceId).name,
      capabilities: MOUNTED_CAMERA_CAPABILITIES,
    }
  }
  return {
    mode: 'wired',
    connected: true,
    sourceId: `mounted-camera:${volumes.map((volume) => volume.id).sort().join('|')}`,
    volumeLabel: `${volumes.length} 个磁盘`,
    host: volumes[0].rootPath,
    httpOk: true,
    controlOk: true,
    message: `已读取 ${volumes.length} 个相机磁盘`,
    deviceId,
    deviceName: deviceDefinitionFor(deviceId).name,
    capabilities: MOUNTED_CAMERA_CAPABILITIES,
  }
}

async function assertInsideMediaRoot(filePath: string, mediaRoots: string[]): Promise<string> {
  const resolved = await fs.realpath(filePath)
  const inside = mediaRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))
  if (!inside) throw new Error('相机素材路径超出允许的磁盘目录')
  return resolved
}

function mountedPathsForFile(file: LunaFile): string[] {
  const urls = [file.sourceUrl, file.previewUrl, file.livePhotoVideoUrl]
    .filter((value): value is string => Boolean(value))
  return [...new Set(urls.map((urlText) => {
    let url: URL
    try {
      url = new URL(urlText)
    } catch {
      throw new Error('素材地址无效，请刷新相机素材后重试')
    }
    if (url.protocol !== 'file:') throw new Error('素材不属于当前有线连接的相机磁盘')
    return fileURLToPath(url)
  }))]
}

export async function deleteMountedCameraFiles(rootPath: string, files: LunaFile[]): Promise<CameraDeleteResult> {
  const volume = await inspectVolume(rootPath, false)
  if (!volume) throw new Error('相机磁盘已断开或没有找到可识别素材')

  return deleteMountedCameraFilesFromVolumes([volume], files)
}

export async function deleteMountedCameraFilesFromVolumes(
  volumes: MountedCameraVolume[],
  files: LunaFile[],
): Promise<CameraDeleteResult> {
  if (volumes.length === 0) throw new Error('相机磁盘已断开或没有找到可识别素材')

  const requestedPaths = [...new Set(files.flatMap(mountedPathsForFile))]
  const mediaRoots = volumes.flatMap((volume) => volume.mediaRoots)
  const result: CameraDeleteResult = { deleted: [], failed: [] }
  for (const requestedPath of requestedPaths) {
    try {
      const stats = await fs.lstat(requestedPath)
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('素材路径不是可删除的相机文件')
      const filePath = await assertInsideMediaRoot(requestedPath, mediaRoots)
      await fs.unlink(filePath)
      result.deleted.push(filePath)
    } catch (error) {
      result.failed.push({
        path: requestedPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  logMainInfo('[有线相机] 删除完成', {
    volumeCount: volumes.length,
    requestedCount: requestedPaths.length,
    deletedCount: result.deleted.length,
    failedCount: result.failed.length,
  })
  return result
}

export async function listMountedCameraFiles(rootPath: string, deviceId: string): Promise<LunaFile[]> {
  const volume = await inspectVolume(rootPath, false)
  if (!volume) throw new Error('相机磁盘已断开或没有找到可识别素材')
  const device = deviceDefinitionFor(deviceId)
  const paths = (await Promise.all(volume.mediaRoots.map((root) => walkMediaFiles(root)))).flat()
  const files: LunaFile[] = []

  for (const rawPath of paths) {
    try {
      const filePath = await assertInsideMediaRoot(rawPath, volume.mediaRoots)
      const name = path.basename(filePath)
      const kind = lunaMediaAdapter.mediaKind(name)
      if (kind === 'unknown') continue
      const stats = await fs.stat(filePath)
      const timestamp = lunaMediaAdapter.capturedAt(name) ?? stats.mtime
      const labels = labelsFor(timestamp)
      const sourceUrl = pathToFileURL(filePath).toString()
      const relativePath = path.relative(volume.rootPath, filePath)
      files.push({
        id: `mounted:${volume.id}:${relativePath}`,
        storageId: 'mounted',
        storageLabel: volume.label,
        sourceDeviceId: deviceId,
        sourceDeviceName: device.name,
        cameraType: device.name,
        watermarkProfileId: deviceId,
        name,
        href: relativePath,
        sourceUrl,
        url: sourceUrl,
        dateText: labels.dateText,
        timeText: labels.timeText,
        sizeText: formatSize(stats.size),
        bytes: stats.size,
        kind,
        extension: lunaMediaAdapter.extensionOf(name),
        capturedAt: labels.capturedAt,
        groupDay: labels.groupDay,
        groupHour: labels.groupHour,
        videoKey: lunaMediaAdapter.videoKey(name),
        previewName: null,
        previewUrl: null,
        cacheFilePath: null,
        downloadFilePath: null,
        thumbnailUrl: kind === 'image' ? sourceUrl : null,
        isLivePhoto: Boolean(lunaMediaAdapter.livePhotoKey(name)),
        livePhotoVideoName: null,
        livePhotoVideoUrl: null,
        livePhotoCacheFilePath: null,
        downloadName: lunaMediaAdapter.downloadName(name),
        rawCompanion: null,
        canPreview: kind === 'image' || kind === 'video' || kind === 'lrv',
      })
    } catch (error) {
      logMainWarn('[有线相机] 跳过无法读取的素材', { rawPath, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const result = lunaMediaAdapter.attachRelatedFiles(files)
  logMainInfo('[有线相机] 素材列表读取完成', { rootPath: volume.rootPath, fileCount: result.length })
  return result
}

export async function listMountedCameraFilesFromVolumes(
  volumes: MountedCameraVolume[],
  deviceId: string,
): Promise<LunaFile[]> {
  const files = await Promise.all(volumes.map((volume) => listMountedCameraFiles(volume.rootPath, deviceId)))
  return files.flat()
}
