import { app } from 'electron'
import { execFile } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import exifr from 'exifr'

import { downloadToFile } from './fileDownloadService'
import { safeName } from './filePathUtils'
import { previewCacheDir } from './settingsService'
import type { LunaFile, MediaMetadata, MetadataEntry } from '../src/shared/types'
import { readMediaDeviceInfo } from './exifReader'

const _require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

// ─── EXIF 元数据缓存（持久化 JSON） ─────────────────────
// 缓存文件以 source URL 的 MD5 命名，存放于 cache_metadata 目录
// 同时记录源文件 mtime，源文件变更时自动失效

interface MetadataCacheEntry {
  version?: number
  mtime: number | null
  data: MediaMetadata
}

const METADATA_CACHE_VERSION = 3

function metadataCacheDir(): string {
  return path.join(app.getPath('userData'), 'cache_metadata')
}

function cacheKeyFor(file: LunaFile): string {
  return crypto.createHash('md5').update(sourceUrlFor(file)).digest('hex')
}

async function readMetadataCache(file: LunaFile, sourcePath: string | null): Promise<MediaMetadata | null> {
  const cachePath = path.join(metadataCacheDir(), `${cacheKeyFor(file)}.json`)
  try {
    const raw = await fs.readFile(cachePath, 'utf-8')
    const entry = JSON.parse(raw) as MetadataCacheEntry
    if (entry.version !== METADATA_CACHE_VERSION) return null

    // 源文件存在时校验 mtime，文件已修改则失效
    if (sourcePath !== null && entry.mtime !== null) {
      try {
        const stat = await fs.stat(sourcePath)
        if (stat.mtimeMs !== entry.mtime) return null
      } catch {
        return null
      }
    }

    return entry.data as MediaMetadata
  } catch {
    return null
  }
}

async function writeMetadataCache(file: LunaFile, sourcePath: string | null, data: MediaMetadata): Promise<void> {
  const dir = metadataCacheDir()
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    return
  }

  let mtime: number | null = null
  if (sourcePath !== null) {
    try {
      const stat = await fs.stat(sourcePath)
      mtime = stat.mtimeMs
    } catch { /* ignore */ }
  }

  const cachePath = path.join(dir, `${cacheKeyFor(file)}.json`)
  const entry: MetadataCacheEntry = { version: METADATA_CACHE_VERSION, mtime, data }
  try {
    await fs.writeFile(cachePath, JSON.stringify(entry), 'utf-8')
  } catch { /* ignore */ }
}

/** 写入缓存并返回结果（在每个返回点调用，确保结果持久化） */
async function cacheReturn(file: LunaFile, sourcePath: string | null, data: MediaMetadata): Promise<MediaMetadata> {
  await writeMetadataCache(file, sourcePath, data)
  return data
}

function getFfprobePath(): string {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, 'ffmpeg', `ffprobe${ext}`)
  }
  try {
    const pkgDir = path.dirname(_require.resolve('ffprobe-static/package.json'))
    return path.join(pkgDir, 'bin', process.platform, process.arch, `ffprobe${process.platform === 'win32' ? '.exe' : ''}`)
  } catch {
    return 'ffprobe'
  }
}

function isFileUrl(url: string): boolean {
  return url.startsWith('file:')
}

function sourceUrlFor(file: LunaFile): string {
  return file.sourceUrl || file.url
}

function localPathForPreview(file: LunaFile): string | null {
  return file.downloadFilePath ?? file.localPath ?? file.cacheFilePath ?? null
}
function isNumericObject(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || value instanceof Date || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  return entries.length > 0 && entries.every(([key, item]) => /^\d+$/.test(key) && typeof item === 'number')
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString()
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  if (ArrayBuffer.isView(value)) return `二进制数据（${value.byteLength} bytes）`
  if (Array.isArray(value)) {
    if (value.length > 12) return `数组（${value.length} 项）`
    return value.map(formatMetadataValue).join(', ')
  }
  if (isNumericObject(value)) {
    const values = Object.values(value)
    if (values.length > 12) return `二进制数据（${values.length} bytes）`
    return values.join(', ')
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 8) return `对象（${entries.length} 项）`
    return entries.map(([key, item]) => `${key}: ${formatMetadataValue(item)}`).join('; ')
  }
  return String(value)
}

function metadataGroupTitle(name: string): string {
  const titles: Record<string, string> = {
    ifd0: 'TIFF / IFD0',
    ifd1: '缩略图 / IFD1',
    exif: 'EXIF',
    gps: 'GPS',
    interop: '互操作信息',
    xmp: 'XMP',
    icc: 'ICC 色彩配置',
    jfif: 'JFIF',
  }
  return titles[name] ?? name
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const parts = value.split('/')
  const fps = parts.length === 2 && Number(parts[1]) > 0
    ? Number(parts[0]) / Number(parts[1])
    : Number(parts[0])
  return fps > 0 ? Math.round(fps * 100) / 100 : null
}

export async function getVideoFrameRate(file: LunaFile, cachedPath?: string | null): Promise<{ frameRate: number | null; duration: number | null }> {
  if (file.kind !== 'video') return { frameRate: null, duration: null }

  let sourcePath: string | null = null
  const candidates = [
    cachedPath,
    file.downloadFilePath,
    file.localPath,
    file.cacheFilePath,
  ].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      sourcePath = candidate
      break
    } catch {
      // Try next local path.
    }
  }

  const sourceUrl = sourceUrlFor(file)
  if (!sourcePath && isFileUrl(sourceUrl)) {
    sourcePath = fileURLToPath(sourceUrl)
  }
  if (!sourcePath) return { frameRate: null, duration: null }

  try {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      sourcePath,
    ], { encoding: 'utf-8' })
    const data = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; r_frame_rate?: string }>; format?: { duration?: string } }
    const videoStream = data.streams?.find((stream) => stream.codec_type === 'video')
    const frameRate = parseFrameRate(videoStream?.r_frame_rate)
    const duration = data.format?.duration ? Math.round(Number(data.format.duration)) : null
    return { frameRate, duration }
  } catch {
    return { frameRate: null, duration: null }
  }
}

export async function getMediaMetadata(file: LunaFile, cachedPath?: string | null): Promise<MediaMetadata> {
  // 解析本地文件路径
  let sourcePath: string | null = null
  if (cachedPath) {
    try {
      await fs.access(cachedPath)
      sourcePath = cachedPath
    } catch {
      sourcePath = null
    }
  }

  if (!sourcePath) {
    const existingLocalPath = localPathForPreview(file)
    if (existingLocalPath) {
      try {
        await fs.access(existingLocalPath)
        sourcePath = existingLocalPath
      } catch {
        sourcePath = null
      }
    }
  }

  const sourceUrl = sourceUrlFor(file)
  if (!sourcePath && isFileUrl(sourceUrl)) {
    sourcePath = fileURLToPath(sourceUrl)
  }

  // ── 优先读取 JSON 缓存 ──
  const cached = await readMetadataCache(file, sourcePath)
  if (cached) return cached

  // 视频：使用 ffprobe 提取元数据
  if (file.kind === 'video') {
    if (!sourcePath) return cacheReturn(file, sourcePath, { groups: [] })
    try {
      const ffprobePath = getFfprobePath()
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        sourcePath,
      ], { encoding: 'utf-8' })
      const data = JSON.parse(stdout) as {
        streams?: Array<{
          codec_type: string
          codec_name?: string
          width?: number
          height?: number
          r_frame_rate?: string
          bit_rate?: string
        }>
        format?: {
          duration?: string
          bit_rate?: string
          size?: string
        }
      }

      const videoStream = data.streams?.find((s) => s.codec_type === 'video')
      if (!videoStream) return cacheReturn(file, sourcePath, { groups: [] })

      const entries: MetadataEntry[] = []
      const deviceInfo = await readMediaDeviceInfo(sourcePath)
      if (deviceInfo?.make) entries.push({ key: 'Make', value: deviceInfo.make })
      if (deviceInfo?.model) entries.push({ key: 'Model', value: deviceInfo.model })
      if (deviceInfo?.firmware) entries.push({ key: 'FirmwareVersion', value: deviceInfo.firmware })

      if (videoStream.width && videoStream.height) {
        entries.push({ key: '分辨率', value: `${videoStream.width} x ${videoStream.height}` })
      }

      if (videoStream.r_frame_rate) {
        const fps = parseFrameRate(videoStream.r_frame_rate)
        if (fps !== null) {
          entries.push({ key: '帧率', value: `${fps} fps` })
        }
      }

      if (videoStream.codec_name) {
        entries.push({ key: '视频编码', value: videoStream.codec_name.toUpperCase() })
      }

      // 码率（ffprobe 可能返回 "N/A" 或空字符串）
      const bitRateRaw = videoStream.bit_rate || data.format?.bit_rate || ''
      const bitRateNum = Number(bitRateRaw)
      if (bitRateNum > 0) {
        const mbps = (bitRateNum / 1_000_000).toFixed(1)
        entries.push({ key: '码率', value: `${mbps} Mbps` })
      }

      if (data.format?.duration) {
        const secs = Math.round(Number(data.format.duration))
        const m = Math.floor(secs / 60)
        const s = secs % 60
        entries.push({ key: '时长', value: `${m}:${String(s).padStart(2, '0')}` })
      }

      // 文件大小：ffprobe format.size 或 fs.stat 兜底
      let fileSizeBytes: number | null = null
      const formatSize = Number(data.format?.size)
      if (formatSize > 0) {
        fileSizeBytes = Math.round(formatSize)
      } else {
        try { const stat = await fs.stat(sourcePath); fileSizeBytes = stat.size } catch { /* ignore */ }
      }
      if (fileSizeBytes !== null) {
        entries.push({ key: 'size', value: String(fileSizeBytes) })
        entries.push({ key: '文件大小', value: `${(fileSizeBytes / 1_000_000).toFixed(1)} MB` })
      }

      // 拍摄时间：文件 mtime 兜底
      try {
        const stat = await fs.stat(sourcePath)
        const ts = stat.mtimeMs
        // 追加为可被 enrichedFile 捕获的元数据
        entries.push({ key: 'ModifyDate', value: new Date(ts).toISOString() })
      } catch { /* ignore */ }

      return cacheReturn(file, sourcePath, { groups: [{ name: '视频', entries }] })
    } catch {
      return cacheReturn(file, sourcePath, { groups: [] })
    }
  }

  // 图片：使用 exifr 提取 EXIF 元数据
  if (!sourcePath) {
    // 如果 sourceUrl 是本地路径，直接尝试读取
    if (sourceUrl && !sourceUrl.startsWith('http://') && !sourceUrl.startsWith('https://')) {
      try {
        await fs.access(sourceUrl)
        sourcePath = sourceUrl
      } catch {
        // 本地文件不存在（可能已被删除），返回空元数据
        return cacheReturn(file, sourcePath, { groups: [] })
      }
    }
  }

  if (!sourcePath) {
    const previewDir = await previewCacheDir()
    sourcePath = path.join(previewDir, safeName(file.name))
    await downloadToFile({ ...file, sourceUrl }, sourcePath)
  }

  const parsed = await exifr.parse(sourcePath, {
    tiff: true,
    ifd1: true,
    exif: true,
    gps: true,
    interop: true,
    xmp: true,
    icc: true,
    jfif: true,
    ihdr: true,
    mergeOutput: false,
  })

  // 文件大小兜底：exifr 可能解析不到（如 PNG 水印图），通过 fs.stat 补充
  let fileBytesFallback: number | null = null
  try {
    const stat = await fs.stat(sourcePath)
    fileBytesFallback = stat.size
  } catch { /* ignore */ }

  if (!parsed || typeof parsed !== 'object') {
    if (fileBytesFallback != null) {
      const mb = (fileBytesFallback / 1_000_000).toFixed(1)
      return cacheReturn(file, sourcePath, { groups: [{ name: '文件', entries: [
        { key: 'size', value: String(fileBytesFallback) },
        { key: '文件大小', value: `${mb} MB` },
      ]}]})
    }
    return cacheReturn(file, sourcePath, { groups: [] })
  }

  const groups: Array<{ name: string; entries: Array<{ key: string; value: string }> }> = []
  let hasSize = false
  for (const [name, values] of Object.entries(parsed as Record<string, Record<string, unknown>>)) {
    const entries = Object.entries(values ?? {}).map(([key, value]) => ({
      key,
      value: formatMetadataValue(value),
    }))
    if (name.toLowerCase() === 'file' && entries.some((e) => e.key === 'size')) hasSize = true
    groups.push({ name: metadataGroupTitle(name), entries })
  }

  // exifr 未提供文件大小时，用 fs.stat 补充
  if (!hasSize && fileBytesFallback != null) {
    const fileGroup = groups.find((g) => g.name === '文件')
    const mb = (fileBytesFallback / 1_000_000).toFixed(1)
    if (fileGroup) {
      fileGroup.entries.push({ key: 'size', value: String(fileBytesFallback) })
      fileGroup.entries.push({ key: '文件大小', value: `${mb} MB` })
    } else {
      groups.unshift({ name: '文件', entries: [
        { key: 'size', value: String(fileBytesFallback) },
        { key: '文件大小', value: `${mb} MB` },
      ]})
    }
  }

  return cacheReturn(file, sourcePath, { groups })
}
