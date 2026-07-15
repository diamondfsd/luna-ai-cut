import { lunaMediaAdapter } from './deviceMedia'
import type { LunaFile } from '../src/shared/types'

const INDEX_RE =
  /<a href="(?<href>[^"]+)">(?<name>[^<]+)<\/a>\s+(?<date>\d{2}-[A-Za-z]{3}-\d{4})\s+(?<time>\d{2}:\d{2})\s+(?<size>\S+)/gi

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

function htmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseSize(text: string): number | null {
  const match = text.trim().match(/^(?<number>\d+(?:\.\d+)?)(?<unit>[KMG])?$/i)
  if (!match?.groups) return null
  const number = Number.parseFloat(match.groups.number)
  const unit = match.groups.unit?.toUpperCase()
  const multiplier = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1
  return Math.floor(number * multiplier)
}

function parseIndexTimestamp(dateText: string, timeText: string): Date | null {
  const dateMatch = dateText.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/)
  const timeMatch = timeText.match(/^(\d{2}):(\d{2})$/)
  if (!dateMatch || !timeMatch) return null
  const month = MONTHS[dateMatch[2]]
  if (month === undefined) return null
  return new Date(Number(dateMatch[3]), month, Number(dateMatch[1]), Number(timeMatch[1]), Number(timeMatch[2]), 0)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function groupLabels(date: Date | null): Pick<LunaFile, 'capturedAt' | 'groupDay' | 'groupHour'> {
  if (!date || Number.isNaN(date.getTime())) {
    return { capturedAt: null, groupDay: '未知日期', groupHour: '未知时间' }
  }
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return {
    capturedAt: date.toISOString(),
    groupDay: day,
    groupHour: `${day} ${pad(date.getHours())}:00`,
  }
}

export function extractCameraSubdirs(html: string): string[] {
  const dirs: string[] = []
  for (const match of html.matchAll(INDEX_RE)) {
    const href = match.groups?.href
    if (!href) continue
    const decoded = htmlDecode(href)
    if (decoded !== '../' && decoded.endsWith('/') && /^Camera\d+\/$/i.test(decoded)) {
      dirs.push(decoded.replace(/\/$/, ''))
    }
  }
  return dirs.sort()
}

export function parseLunaIndex(html: string, baseUrl: string): LunaFile[] {
  const files: LunaFile[] = []
  for (const match of html.matchAll(INDEX_RE)) {
    const groups = match.groups
    if (!groups) continue
    const href = htmlDecode(groups.href)
    const name = htmlDecode(groups.name)
    if (href === '../' || name === '../' || href.endsWith('/')) continue
    const kind = lunaMediaAdapter.mediaKind(name)
    const timestamp = lunaMediaAdapter.capturedAt(name) ?? parseIndexTimestamp(groups.date, groups.time)
    const labels = groupLabels(timestamp)
    const videoKey = lunaMediaAdapter.videoKey(name)
    const livePhotoKey = lunaMediaAdapter.livePhotoKey(name)
    const url = new URL(href, baseUrl).toString()
    files.push({
      id: name, name, href, sourceUrl: url, url,
      dateText: groups.date, timeText: groups.time, sizeText: groups.size,
      bytes: parseSize(groups.size), kind, extension: lunaMediaAdapter.extensionOf(name), videoKey,
      capturedAt: labels.capturedAt, groupDay: labels.groupDay, groupHour: labels.groupHour,
      previewName: null, previewUrl: null, cacheFilePath: null, downloadFilePath: null, thumbnailUrl: null,
      isLivePhoto: Boolean(livePhotoKey), livePhotoVideoName: null, livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null, downloadName: lunaMediaAdapter.downloadName(name),
      canPreview: kind === 'image' || kind === 'video' || kind === 'lrv',
    })
  }
  return lunaMediaAdapter.attachRelatedFiles(files).map((file) => ({
    ...file,
    thumbnailUrl: null,
    livePhotoCacheFilePath: null,
  }))
}
