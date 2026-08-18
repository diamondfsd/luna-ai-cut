import { app } from 'electron'
import { execFile } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import exifr from 'exifr'
import { detectInsta360ILog } from './iLogDetection'

import { downloadToFile } from './fileDownloadService'
import { safeName } from './filePathUtils'
import { currentBaseDir, previewCacheDir } from './settingsService'
import type { LunaFile, MediaMetadata, MetadataEntry } from '../src/shared/types'
import { readMediaDeviceInfo } from './exifReader'
import { lunaMediaAdapter } from './deviceMedia'

const _require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

// ─── EXIF 元数据缓存（持久化 JSON） ─────────────────────
// 缓存文件以 source URL 的 MD5 命名，存放于基础目录的 cache/metadata 目录
// 同时记录源文件 mtime，源文件变更时自动失效

interface MetadataCacheEntry {
  version?: number
  mtime: number | null
  data: MediaMetadata
}

const METADATA_CACHE_VERSION = 4

function metadataCacheDir(): string {
  return path.join(currentBaseDir(), 'cache', 'metadata')
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

function sourceUrlFor(file: Pick<LunaFile, 'sourceUrl' | 'url'>): string {
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
  return Number.isFinite(fps) && fps > 0 && fps <= 1000
    ? Math.round(fps * 100) / 100
    : null
}

interface VideoProbeStream {
  codec_type: string
  codec_name?: string
  codec_long_name?: string
  profile?: string
  codec_tag_string?: string
  width?: number
  height?: number
  pix_fmt?: string
  color_range?: string
  color_space?: string
  color_transfer?: string
  color_primaries?: string
  chroma_location?: string
  sample_aspect_ratio?: string
  display_aspect_ratio?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  bit_rate?: string
  nb_frames?: string
  sample_rate?: string
  channels?: number
  channel_layout?: string
  bits_per_sample?: number
  tags?: Record<string, string>
  disposition?: Record<string, number>
  side_data_list?: Array<{
    side_data_type?: string
    dv_profile?: number | string
    dv_bl_signal_compatibility_id?: number | string
    [key: string]: unknown
  }>
}

interface VideoProbeFormat {
  duration?: string
  format_name?: string
  format_long_name?: string
  bit_rate?: string
  size?: string
  nb_streams?: number
  tags?: Record<string, string>
}

interface VideoProbeChapter {
  id?: number | string
  start_time?: string
  end_time?: string
  tags?: Record<string, string>
}

function probeTagValue(tags: Record<string, string> | undefined, key: string): string | undefined {
  if (!tags) return undefined
  const expected = key.toLowerCase()
  return Object.entries(tags).find(([name]) => name.toLowerCase() === expected)?.[1]
}

function firstVideoTag(data: { streams?: VideoProbeStream[]; format?: VideoProbeFormat }, key: string): string | undefined {
  return data.streams?.map((stream) => probeTagValue(stream.tags, key)).find(Boolean)
    ?? probeTagValue(data.format?.tags, key)
}

function validProbeDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatBitrate(value: string | undefined): string | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? `${(numeric / 1_000_000).toFixed(1)} Mbps` : null
}

function formatFrameRate(value: string | undefined): string | null {
  const rate = parseFrameRate(value)
  return rate === null ? null : `${rate} fps`
}

function appendProbeTags(entries: MetadataEntry[], tags: Record<string, string> | undefined, prefix: string): void {
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (!value || key.toLowerCase() === 'creation_time') continue
    entries.push({ key: `${prefix}${key}`, value: formatMetadataValue(value) })
  }
}

function appendSideData(entries: MetadataEntry[], sideDataList: VideoProbeStream['side_data_list']): void {
  for (const sideData of sideDataList ?? []) {
    const type = sideData.side_data_type ?? '附加信息'
    const details = Object.entries(sideData)
      .filter(([key, value]) => key !== 'side_data_type' && value !== undefined && value !== null)
      .map(([key, value]) => `${key}: ${formatMetadataValue(value)}`)
    if (details.length > 0) entries.push({ key: `附加信息 · ${type}`, value: details.join('; ') })
  }
}

function dolbyVisionInfo(stream: VideoProbeStream | undefined, format: VideoProbeFormat | undefined): { dolbyVision: boolean; dolbyVisionProfile: number | null } {
  const configuration = stream?.side_data_list?.find((entry) => entry.side_data_type?.toLowerCase().includes('dovi configuration'))
  const brands = format?.tags?.compatible_brands?.toLowerCase() ?? ''
  const profile = Number(configuration?.dv_profile)
  return {
    dolbyVision: Boolean(configuration || brands.includes('dby1')),
    dolbyVisionProfile: Number.isFinite(profile) ? profile : null,
  }
}

interface VideoProbeResult {
  frameRate: number | null
  duration: number | null
  videoBitrate: number | null
  dolbyVision: boolean | null
  dolbyVisionProfile: number | null
  iLog: boolean | null
}

export async function getVideoFrameRate(
  file: Pick<LunaFile, 'kind' | 'downloadFilePath' | 'localPath' | 'cacheFilePath' | 'sourceUrl' | 'url'>,
  cachedPath?: string | null,
): Promise<VideoProbeResult> {
  if (file.kind !== 'video') return { frameRate: null, duration: null, videoBitrate: null, dolbyVision: null, dolbyVisionProfile: null, iLog: null }

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
  if (!sourcePath) return { frameRate: null, duration: null, videoBitrate: null, dolbyVision: null, dolbyVisionProfile: null, iLog: null }

  try {
    const [{ stdout }, iLog] = await Promise.all([
      execFileAsync(getFfprobePath(), [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        sourcePath,
      ], { encoding: 'utf-8' }),
      detectInsta360ILog(sourcePath),
    ])
    const data = JSON.parse(stdout) as { streams?: VideoProbeStream[]; format?: VideoProbeFormat }
    const videoStream = data.streams?.find((stream) => stream.codec_type === 'video')
    const frameRate = parseFrameRate(videoStream?.avg_frame_rate)
      ?? parseFrameRate(videoStream?.r_frame_rate)
    const duration = data.format?.duration ? Math.round(Number(data.format.duration)) : null
    const numericBitrate = Number(videoStream?.bit_rate)
    const videoBitrate = Number.isFinite(numericBitrate) && numericBitrate > 0
      ? Math.round(numericBitrate)
      : null
    return { frameRate, duration, videoBitrate, ...dolbyVisionInfo(videoStream, data.format), iLog }
  } catch {
    return { frameRate: null, duration: null, videoBitrate: null, dolbyVision: null, dolbyVisionProfile: null, iLog: null }
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
        '-show_chapters',
        sourcePath,
      ], { encoding: 'utf-8' })
      const data = JSON.parse(stdout) as {
        streams?: VideoProbeStream[]
        chapters?: VideoProbeChapter[]
        format?: VideoProbeFormat
      }

      const videoStream = data.streams?.find((s) => s.codec_type === 'video')
      if (!videoStream) return cacheReturn(file, sourcePath, { groups: [] })

      const deviceInfo = await readMediaDeviceInfo(sourcePath)
      const formatTags = data.format?.tags ?? {}
      const sourceNameDate = lunaMediaAdapter.capturedAt(path.basename(sourcePath))
      const metadataDate = validProbeDate(firstVideoTag(data, 'creation_time'))
      const captureDate = metadataDate ?? sourceNameDate
      const videoEntries: MetadataEntry[] = []
      if (deviceInfo?.make || probeTagValue(formatTags, 'make')) {
        videoEntries.push({ key: 'Make', value: deviceInfo?.make || probeTagValue(formatTags, 'make')! })
      }
      if (deviceInfo?.model || probeTagValue(formatTags, 'model')) {
        videoEntries.push({ key: 'Model', value: deviceInfo?.model || probeTagValue(formatTags, 'model')! })
      }
      if (deviceInfo?.firmware || probeTagValue(formatTags, 'firmware')) {
        videoEntries.push({ key: 'FirmwareVersion', value: deviceInfo?.firmware || probeTagValue(formatTags, 'firmware')! })
      }
      if (deviceInfo?.serialNumber || probeTagValue(formatTags, 'serial_number')) {
        videoEntries.push({ key: 'SerialNumber', value: deviceInfo?.serialNumber || probeTagValue(formatTags, 'serial_number')! })
      }
      if (videoStream.width && videoStream.height) videoEntries.push({ key: '分辨率', value: `${videoStream.width} x ${videoStream.height}` })
      const fps = parseFrameRate(videoStream.avg_frame_rate)
        ?? parseFrameRate(videoStream.r_frame_rate)
      if (fps !== null) videoEntries.push({ key: '帧率', value: `${fps} fps` })
      const videoDuration = Number(videoStream.duration ?? data.format?.duration)
      if (Number.isFinite(videoDuration) && videoDuration > 0) {
        const seconds = Math.round(videoDuration)
        videoEntries.push({ key: '时长', value: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` })
      }
      if (videoStream.codec_name) videoEntries.push({ key: '视频编码', value: videoStream.codec_name.toUpperCase() })
      if (videoStream.codec_long_name) videoEntries.push({ key: '编码描述', value: videoStream.codec_long_name })
      if (videoStream.profile) videoEntries.push({ key: '编码配置', value: videoStream.profile })
      if (videoStream.codec_tag_string) videoEntries.push({ key: '封装标识', value: videoStream.codec_tag_string })
      if (videoStream.pix_fmt) videoEntries.push({ key: '像素格式', value: videoStream.pix_fmt })
      if (videoStream.sample_aspect_ratio) videoEntries.push({ key: '采样宽高比', value: videoStream.sample_aspect_ratio })
      if (videoStream.display_aspect_ratio) videoEntries.push({ key: '显示宽高比', value: videoStream.display_aspect_ratio })
      if (videoStream.color_range) videoEntries.push({ key: '色彩范围', value: videoStream.color_range })
      if (videoStream.color_space) videoEntries.push({ key: '色彩空间', value: videoStream.color_space })
      if (videoStream.color_transfer) videoEntries.push({ key: '色彩传输', value: videoStream.color_transfer })
      if (videoStream.color_primaries) videoEntries.push({ key: '色彩原色', value: videoStream.color_primaries })
      if (videoStream.chroma_location) videoEntries.push({ key: '色度位置', value: videoStream.chroma_location })
      if (formatFrameRate(videoStream.avg_frame_rate)) videoEntries.push({ key: '平均帧率', value: formatFrameRate(videoStream.avg_frame_rate)! })
      if (videoStream.nb_frames) videoEntries.push({ key: '帧数', value: videoStream.nb_frames })
      if (formatBitrate(videoStream.bit_rate ?? data.format?.bit_rate)) videoEntries.push({ key: '码率', value: formatBitrate(videoStream.bit_rate ?? data.format?.bit_rate)! })
      appendProbeTags(videoEntries, videoStream.tags, '标签 · ')
      appendSideData(videoEntries, videoStream.side_data_list)

      const audioEntries: MetadataEntry[] = []
      for (const [audioIndex, audioStream] of (data.streams ?? []).filter((stream) => stream.codec_type === 'audio').entries()) {
        const prefix = audioIndex === 0 ? '' : `轨道 ${audioIndex + 1} `
        if (audioStream.codec_name) audioEntries.push({ key: `${prefix}音频编码`, value: audioStream.codec_name.toUpperCase() })
        if (audioStream.profile) audioEntries.push({ key: `${prefix}编码配置`, value: audioStream.profile })
        if (audioStream.sample_rate) audioEntries.push({ key: `${prefix}采样率`, value: `${audioStream.sample_rate} Hz` })
        if (audioStream.channels) audioEntries.push({ key: `${prefix}声道数`, value: String(audioStream.channels) })
        if (audioStream.channel_layout) audioEntries.push({ key: `${prefix}声道布局`, value: audioStream.channel_layout })
        if (audioStream.bits_per_sample) audioEntries.push({ key: `${prefix}采样位深`, value: `${audioStream.bits_per_sample} bit` })
        if (formatBitrate(audioStream.bit_rate)) audioEntries.push({ key: `${prefix}码率`, value: formatBitrate(audioStream.bit_rate)! })
        if (audioStream.duration) audioEntries.push({ key: `${prefix}时长`, value: `${Number(audioStream.duration).toFixed(3)} 秒` })
        appendProbeTags(audioEntries, audioStream.tags, `${prefix}标签 · `)
      }

      const containerEntries: MetadataEntry[] = []
      if (data.format?.format_long_name) containerEntries.push({ key: '格式', value: data.format.format_long_name })
      if (data.format?.format_name) containerEntries.push({ key: '格式标识', value: data.format.format_name })
      if (data.format?.nb_streams !== undefined) containerEntries.push({ key: '轨道数', value: String(data.format.nb_streams) })
      if (formatBitrate(data.format?.bit_rate)) containerEntries.push({ key: '总码率', value: formatBitrate(data.format?.bit_rate)! })
      for (const [key, value] of Object.entries(formatTags)) {
        if (key.toLowerCase() === 'creation_time' || !value) continue
        containerEntries.push({ key: `标签 · ${key}`, value })
      }

      const entries: MetadataEntry[] = []
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
      if (captureDate) entries.push({ key: 'DateTimeOriginal', value: captureDate.toISOString() })
      try {
        const stat = await fs.stat(sourcePath)
        const ts = stat.mtimeMs
        entries.push({ key: 'ModifyDate', value: new Date(ts).toISOString() })
      } catch { /* ignore */ }

      const groups: Array<{ name: string; entries: MetadataEntry[] }> = [{ name: '文件', entries }]
      if (videoEntries.length > 0) groups.push({ name: '视频', entries: videoEntries })
      if (audioEntries.length > 0) groups.push({ name: '音频', entries: audioEntries })
      if (containerEntries.length > 0) groups.push({ name: '容器', entries: containerEntries })
      for (const [index, chapter] of (data.chapters ?? []).entries()) {
        const chapterEntries: MetadataEntry[] = [{ key: '编号', value: String(chapter.id ?? index + 1) }]
        if (chapter.start_time) chapterEntries.push({ key: '开始', value: `${Number(chapter.start_time).toFixed(3)} 秒` })
        if (chapter.end_time) chapterEntries.push({ key: '结束', value: `${Number(chapter.end_time).toFixed(3)} 秒` })
        const title = probeTagValue(chapter.tags, 'title')
        if (title) chapterEntries.push({ key: '标题', value: title })
        groups.push({ name: `章节 ${index + 1}`, entries: chapterEntries })
      }
      return cacheReturn(file, sourcePath, { groups })
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
