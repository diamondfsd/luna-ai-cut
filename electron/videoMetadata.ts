import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { LunaFile, MediaMetadata, MetadataEntry } from '../src/shared/types'
import { lunaMediaAdapter } from './deviceMedia'
import { readMediaDeviceInfo } from './exifReader'

export interface VideoProbeStream {
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

export interface VideoProbeFormat {
  duration?: string
  format_name?: string
  format_long_name?: string
  bit_rate?: string
  size?: string
  nb_streams?: number
  tags?: Record<string, string>
}

export interface VideoProbeChapter {
  id?: number | string
  start_time?: string
  end_time?: string
  tags?: Record<string, string>
}

export interface VideoProbeData {
  streams?: VideoProbeStream[]
  chapters?: VideoProbeChapter[]
  format?: VideoProbeFormat
}

export function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const parts = value.split('/')
  const fps = parts.length === 2 && Number(parts[1]) > 0
    ? Number(parts[0]) / Number(parts[1])
    : Number(parts[0])
  return Number.isFinite(fps) && fps > 0 && fps <= 1000
    ? Math.round(fps * 100) / 100
    : null
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString()
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length > 12 ? `数组（${value.length} 项）` : value.map(formatMetadataValue).join(', ')
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length > 8
      ? `对象（${entries.length} 项）`
      : entries.map(([key, item]) => `${key}: ${formatMetadataValue(item)}`).join('; ')
  }
  return String(value)
}

export function formatBitrate(value: string | undefined): string | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? `${(numeric / 1_000_000).toFixed(1)} Mbps` : null
}

export function formatFrameRate(value: string | undefined): string | null {
  const rate = parseFrameRate(value)
  return rate === null ? null : `${rate} fps`
}

export function probeTagValue(tags: Record<string, string> | undefined, key: string): string | undefined {
  if (!tags) return undefined
  const expected = key.toLowerCase()
  return Object.entries(tags).find(([name]) => name.toLowerCase() === expected)?.[1]
}

function firstVideoTag(data: VideoProbeData, key: string): string | undefined {
  return data.streams?.map((stream) => probeTagValue(stream.tags, key)).find(Boolean)
    ?? probeTagValue(data.format?.tags, key)
}

function validProbeDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
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

export function dolbyVisionInfo(stream: VideoProbeStream | undefined, format: VideoProbeFormat | undefined): { dolbyVision: boolean; dolbyVisionProfile: number | null } {
  const configuration = stream?.side_data_list?.find((entry) => entry.side_data_type?.toLowerCase().includes('dovi configuration'))
  const brands = format?.tags?.compatible_brands?.toLowerCase() ?? ''
  const profile = Number(configuration?.dv_profile)
  return {
    dolbyVision: Boolean(configuration || brands.includes('dby1')),
    dolbyVisionProfile: Number.isFinite(profile) ? profile : null,
  }
}

function captureDateFor(file: LunaFile, sourcePath: string | null, data: VideoProbeData): Date | null {
  return validProbeDate(firstVideoTag(data, 'creation_time'))
    ?? lunaMediaAdapter.capturedAt(file.name)
    ?? (sourcePath ? lunaMediaAdapter.capturedAt(path.basename(sourcePath)) : null)
    ?? validProbeDate(file.capturedAt)
}

function pushEntry(entries: MetadataEntry[], key: string, value: string | null | undefined): void {
  if (value) entries.push({ key, value })
}

export async function buildVideoMetadata(
  file: LunaFile,
  sourcePath: string | null,
  sourceUrl: string,
  data: VideoProbeData,
): Promise<MediaMetadata> {
  const videoStream = data.streams?.find((stream) => stream.codec_type === 'video')
  if (!videoStream) return { groups: [] }

  const deviceSource = sourcePath ?? (/^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined)
  const deviceInfo = await readMediaDeviceInfo(deviceSource)
  const formatTags = data.format?.tags ?? {}
  const videoEntries: MetadataEntry[] = []
  pushEntry(videoEntries, 'Make', deviceInfo?.make || probeTagValue(formatTags, 'make'))
  pushEntry(videoEntries, 'Model', deviceInfo?.model || probeTagValue(formatTags, 'model'))
  pushEntry(videoEntries, 'FirmwareVersion', deviceInfo?.firmware || probeTagValue(formatTags, 'firmware'))
  pushEntry(videoEntries, 'SerialNumber', deviceInfo?.serialNumber || probeTagValue(formatTags, 'serial_number'))
  if (videoStream.width && videoStream.height) pushEntry(videoEntries, '分辨率', `${videoStream.width} x ${videoStream.height}`)
  pushEntry(videoEntries, '帧率', formatFrameRate(videoStream.avg_frame_rate) ?? formatFrameRate(videoStream.r_frame_rate))
  const videoDuration = Number(videoStream.duration ?? data.format?.duration)
  if (Number.isFinite(videoDuration) && videoDuration > 0) {
    const seconds = Math.round(videoDuration)
    pushEntry(videoEntries, '时长', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)
  }
  pushEntry(videoEntries, '视频编码', videoStream.codec_name?.toUpperCase())
  pushEntry(videoEntries, '编码描述', videoStream.codec_long_name)
  pushEntry(videoEntries, '编码配置', videoStream.profile)
  pushEntry(videoEntries, '封装标识', videoStream.codec_tag_string)
  pushEntry(videoEntries, '像素格式', videoStream.pix_fmt)
  pushEntry(videoEntries, '采样宽高比', videoStream.sample_aspect_ratio)
  pushEntry(videoEntries, '显示宽高比', videoStream.display_aspect_ratio)
  pushEntry(videoEntries, '色彩范围', videoStream.color_range)
  pushEntry(videoEntries, '色彩空间', videoStream.color_space)
  pushEntry(videoEntries, '色彩传输', videoStream.color_transfer)
  pushEntry(videoEntries, '色彩原色', videoStream.color_primaries)
  pushEntry(videoEntries, '色度位置', videoStream.chroma_location)
  pushEntry(videoEntries, '平均帧率', formatFrameRate(videoStream.avg_frame_rate))
  pushEntry(videoEntries, '原始帧率', formatFrameRate(videoStream.r_frame_rate))
  pushEntry(videoEntries, '帧数', videoStream.nb_frames)
  pushEntry(videoEntries, '码率', formatBitrate(videoStream.bit_rate ?? data.format?.bit_rate))
  appendProbeTags(videoEntries, videoStream.tags, '标签 · ')
  appendSideData(videoEntries, videoStream.side_data_list)

  const audioEntries: MetadataEntry[] = []
  for (const [audioIndex, audioStream] of (data.streams ?? []).filter((stream) => stream.codec_type === 'audio').entries()) {
    const prefix = audioIndex === 0 ? '' : `轨道 ${audioIndex + 1} `
    pushEntry(audioEntries, `${prefix}音频编码`, audioStream.codec_name?.toUpperCase())
    pushEntry(audioEntries, `${prefix}编码配置`, audioStream.profile)
    pushEntry(audioEntries, `${prefix}采样率`, audioStream.sample_rate ? `${audioStream.sample_rate} Hz` : null)
    pushEntry(audioEntries, `${prefix}声道数`, audioStream.channels ? String(audioStream.channels) : null)
    pushEntry(audioEntries, `${prefix}声道布局`, audioStream.channel_layout)
    pushEntry(audioEntries, `${prefix}采样位深`, audioStream.bits_per_sample ? `${audioStream.bits_per_sample} bit` : null)
    pushEntry(audioEntries, `${prefix}码率`, formatBitrate(audioStream.bit_rate))
    pushEntry(audioEntries, `${prefix}时长`, audioStream.duration ? `${Number(audioStream.duration).toFixed(3)} 秒` : null)
    appendProbeTags(audioEntries, audioStream.tags, `${prefix}标签 · `)
  }

  const containerEntries: MetadataEntry[] = []
  pushEntry(containerEntries, '格式', data.format?.format_long_name)
  pushEntry(containerEntries, '格式标识', data.format?.format_name)
  pushEntry(containerEntries, '轨道数', data.format?.nb_streams === undefined ? null : String(data.format.nb_streams))
  pushEntry(containerEntries, '总码率', formatBitrate(data.format?.bit_rate))
  for (const [key, value] of Object.entries(formatTags)) {
    if (key.toLowerCase() !== 'creation_time' && value) containerEntries.push({ key: `标签 · ${key}`, value })
  }

  const fileEntries: MetadataEntry[] = []
  let fileSizeBytes: number | null = null
  const formatSize = Number(data.format?.size)
  if (formatSize > 0) fileSizeBytes = Math.round(formatSize)
  else if (sourcePath) {
    try { fileSizeBytes = (await fs.stat(sourcePath)).size } catch { /* ignore */ }
  } else if (file.bytes != null && file.bytes > 0) fileSizeBytes = file.bytes
  if (fileSizeBytes !== null) {
    fileEntries.push({ key: 'size', value: String(fileSizeBytes) })
    fileEntries.push({ key: '文件大小', value: `${(fileSizeBytes / 1_000_000).toFixed(1)} MB` })
  }
  const captureDate = captureDateFor(file, sourcePath, data)
  if (captureDate) fileEntries.push({ key: 'DateTimeOriginal', value: captureDate.toISOString() })
  if (sourcePath) {
    try { fileEntries.push({ key: 'ModifyDate', value: new Date((await fs.stat(sourcePath)).mtimeMs).toISOString() }) } catch { /* ignore */ }
  }

  const groups: MediaMetadata['groups'] = [{ name: '文件', entries: fileEntries }]
  if (videoEntries.length > 0) groups.push({ name: '视频', entries: videoEntries })
  if (audioEntries.length > 0) groups.push({ name: '音频', entries: audioEntries })
  if (containerEntries.length > 0) groups.push({ name: '容器', entries: containerEntries })
  for (const [index, chapter] of (data.chapters ?? []).entries()) {
    const chapterEntries: MetadataEntry[] = [{ key: '编号', value: String(chapter.id ?? index + 1) }]
    pushEntry(chapterEntries, '开始', chapter.start_time ? `${Number(chapter.start_time).toFixed(3)} 秒` : null)
    pushEntry(chapterEntries, '结束', chapter.end_time ? `${Number(chapter.end_time).toFixed(3)} 秒` : null)
    pushEntry(chapterEntries, '标题', probeTagValue(chapter.tags, 'title'))
    groups.push({ name: `章节 ${index + 1}`, entries: chapterEntries })
  }
  return { groups }
}
