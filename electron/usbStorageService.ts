import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { lunaMediaAdapter } from './deviceMedia'
import { labelsFor } from './filePathUtils'
import type { DeviceStorageOption, LunaFile, UsbDeviceCandidate } from '../src/shared/types'

const execFileAsync = promisify(execFile)

interface WindowsLogicalDisk {
  DeviceID?: string
  VolumeName?: string
  FileSystem?: string
  DriveType?: number
  FreeSpace?: number | string | null
  Size?: number | string | null
}

export interface UsbStorageVolume {
  storageId: string
  label: string
  rootPath: string
  mediaRoot: string
  freeBytes: number | null
  totalBytes: number | null
}

const MEDIA_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.dng',
  '.insp',
  '.mp4',
  '.mov',
  '.insv',
  '.lrv',
  '.liv',
])

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function storageIdForVolume(label: string, rootPath: string): string {
  const normalized = `${label} ${rootPath}`.toLowerCase()
  if (normalized.includes('internal')) return 'storage_internal'
  if (normalized.includes('sd') || normalized.includes('luna')) return 'sdcard'
  return `usb_${rootPath.replace(/[^a-z0-9]/gi, '').toLowerCase()}`
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveMediaRoot(rootPath: string): Promise<string | null> {
  const candidates = [
    path.join(rootPath, 'DCIM', 'Camera01'),
    path.join(rootPath, 'DCIM', '100MEDIA'),
    path.join(rootPath, 'DCIM'),
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

function normalizeWindowsDriveRoot(deviceId: string): string {
  return deviceId.endsWith('\\') ? deviceId : `${deviceId}\\`
}

function normalizeWindowsDiskPayload(stdout: string): WindowsLogicalDisk[] {
  const text = stdout.trim()
  if (!text) return []
  const parsed = JSON.parse(text) as WindowsLogicalDisk | WindowsLogicalDisk[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function windowsLogicalDisks(): Promise<WindowsLogicalDisk[]> {
  const script = [
    '$ErrorActionPreference = "Stop";',
    'Get-CimInstance Win32_LogicalDisk |',
    'Where-Object { $_.DriveType -eq 2 -or $_.DriveType -eq 3 } |',
    'Select-Object DeviceID,VolumeName,FileSystem,DriveType,FreeSpace,Size |',
    'ConvertTo-Json -Compress',
  ].join(' ')

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  })
  return normalizeWindowsDiskPayload(stdout)
}

export async function scanUsbStorageVolumes(): Promise<UsbStorageVolume[]> {
  if (process.platform !== 'win32') return []

  const volumes: UsbStorageVolume[] = []
  let disks: WindowsLogicalDisk[]
  try {
    disks = await windowsLogicalDisks()
  } catch (error) {
    console.warn('[usb-storage] failed to scan Windows logical disks', error)
    return []
  }

  for (const disk of disks) {
    const deviceId = typeof disk.DeviceID === 'string' ? disk.DeviceID : ''
    if (!deviceId) continue

    const rootPath = normalizeWindowsDriveRoot(deviceId)
    const label = typeof disk.VolumeName === 'string' && disk.VolumeName.trim()
      ? disk.VolumeName.trim()
      : deviceId
    const mediaRoot = await resolveMediaRoot(rootPath)
    const searchText = `${label} ${rootPath} ${mediaRoot ?? ''}`.toLowerCase()
    const likelyCameraVolume = Boolean(mediaRoot) && (
      searchText.includes('internal')
      || searchText.includes('luna')
      || searchText.includes('insta360')
      || searchText.includes('dcim')
    )
    if (!likelyCameraVolume || !mediaRoot) continue

    volumes.push({
      storageId: storageIdForVolume(label, rootPath),
      label,
      rootPath,
      mediaRoot,
      freeBytes: toNumber(disk.FreeSpace),
      totalBytes: toNumber(disk.Size),
    })
  }

  return volumes.sort((a, b) => {
    const order = (id: string): number => id === 'storage_internal' ? 0 : id === 'sdcard' ? 1 : 2
    return order(a.storageId) - order(b.storageId) || a.label.localeCompare(b.label)
  })
}

export async function scanUsbStorageDevices(): Promise<UsbDeviceCandidate[]> {
  const volumes = await scanUsbStorageVolumes()
  return volumes.map((volume) => ({
    id: `volume:${volume.rootPath}`,
    name: volume.label,
    manufacturer: 'Windows Volume',
    serialNumber: volume.rootPath,
    busName: 'File Transfer',
    mountPath: volume.rootPath,
    storageId: volume.storageId,
    freeBytes: volume.freeBytes,
    totalBytes: volume.totalBytes,
    transport: 'usb',
    matched: true,
    source: 'powershell',
  }))
}

async function collectMediaFiles(root: string, limit = 5000): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string): Promise<void> {
    if (results.length >= limit) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= limit || entry.name.startsWith('.')) continue
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(entryPath)
      }
    }
  }

  await walk(root)
  return results
}

function previewNameFor(filePath: string): string | null {
  const parsed = path.parse(filePath)
  const lrvPath = path.join(parsed.dir, `${parsed.name}.LRV`)
  return lrvPath
}

export async function listUsbStorageFiles(storageFilter = 'all'): Promise<LunaFile[]> {
  const volumes = await scanUsbStorageVolumes()
  const selected = storageFilter === 'all'
    ? volumes
    : volumes.filter((volume) => volume.storageId === storageFilter)

  const files: LunaFile[] = []
  for (const volume of selected.length > 0 ? selected : volumes) {
    for (const filePath of await collectMediaFiles(volume.mediaRoot)) {
      const name = path.basename(filePath)
      const kind = lunaMediaAdapter.mediaKind(name)
      if (kind === 'unknown' || kind === 'lrv') continue

      const stats = await fs.stat(filePath)
      const capturedAt = lunaMediaAdapter.capturedAt(name) ?? stats.mtime
      const labels = labelsFor(capturedAt)
      const fileUrl = pathToFileURL(filePath).toString()
      const previewPath = kind === 'video' ? previewNameFor(filePath) : null
      const hasPreview = previewPath ? await pathExists(previewPath) : false

      files.push({
        id: `${volume.storageId}:${filePath}`,
        storageId: volume.storageId,
        storageLabel: volume.label,
        name,
        href: filePath,
        sourceUrl: fileUrl,
        url: fileUrl,
        dateText: labels.dateText,
        timeText: labels.timeText,
        sizeText: String(stats.size),
        bytes: stats.size,
        kind,
        extension: lunaMediaAdapter.extensionOf(name),
        capturedAt: labels.capturedAt,
        groupDay: labels.groupDay,
        groupHour: labels.groupHour,
        videoKey: lunaMediaAdapter.videoKey(name),
        previewName: hasPreview && previewPath ? path.basename(previewPath) : null,
        previewUrl: hasPreview && previewPath ? pathToFileURL(previewPath).toString() : null,
        cacheFilePath: null,
        downloadFilePath: null,
        thumbnailUrl: null,
        isLivePhoto: Boolean(lunaMediaAdapter.livePhotoKey(name)),
        livePhotoVideoName: null,
        livePhotoVideoUrl: null,
        livePhotoCacheFilePath: null,
        downloadName: name,
        canPreview: kind === 'image' || kind === 'video',
        localPath: filePath,
      })
    }
  }

  return lunaMediaAdapter.attachRelatedFiles(files).sort((a, b) => {
    const aTime = a.capturedAt ? Date.parse(a.capturedAt) : 0
    const bTime = b.capturedAt ? Date.parse(b.capturedAt) : 0
    return bTime - aTime || a.name.localeCompare(b.name)
  })
}

export function usbStorageOptions(volumes: UsbStorageVolume[]): DeviceStorageOption[] {
  return volumes.map((volume) => ({
    id: volume.storageId,
    label: volume.storageId === 'storage_internal' ? '内置存储' : volume.label,
    path: volume.mediaRoot,
    default: volume.storageId === 'storage_internal',
  }))
}
