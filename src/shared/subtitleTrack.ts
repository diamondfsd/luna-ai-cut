import OpenCC from 'opencc-js/t2cn'
import type { WorkspaceSubtitleCue, WorkspaceSubtitleStyle, WorkspaceSubtitleTrack } from './types/subtitles'

export const SUBTITLE_BUILTIN_FONT = {
  fileName: 'SourceHanSansSC-Regular.otf',
  filePath: 'fonts/SourceHanSansSC-Regular.otf',
  format: 'otf',
} as const

export const DEFAULT_SUBTITLE_STYLE: WorkspaceSubtitleStyle = {
  fontSize: 50,
  fontWeight: 400,
  fontFamily: 'Source Han Sans SC',
  fontFile: SUBTITLE_BUILTIN_FONT.filePath,
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 60,
  borderColor: '#FFFFFF',
  borderWidth: 0,
  cornerRadius: 60,
  positionY: 90,
}

let traditionalToSimplified: ((text: string) => string) | null = null

export function simplifyChineseText(text: string): string {
  traditionalToSimplified ??= OpenCC.Converter({ from: 't', to: 'cn' })
  return traditionalToSimplified(text)
}

function finiteInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback
}

export function normalizeSubtitleStyle(value: unknown): WorkspaceSubtitleStyle {
  const style = value && typeof value === 'object' ? value as Partial<WorkspaceSubtitleStyle> : {}
  const validFontAsset = (font: unknown) => font
    && typeof font === 'object'
    && typeof (font as { fileName?: unknown }).fileName === 'string'
    && typeof (font as { filePath?: unknown }).filePath === 'string'
    && ((font as { format?: unknown }).format === 'otf' || (font as { format?: unknown }).format === 'ttf')
  const customFont = validFontAsset(style.customFont) ? style.customFont : undefined
  const fontAssets = [...(Array.isArray(style.fontAssets) ? style.fontAssets.filter(validFontAsset) : []), ...(customFont ? [customFont] : [])]
    .filter((font, index, all) => all.findIndex((item) => item.filePath === font.filePath) === index)
  const rawWeight = Number(style.fontWeight)
  const weight: WorkspaceSubtitleStyle['fontWeight'] = rawWeight >= 700 ? 700 : rawWeight <= 350 ? 300 : 400
  return {
    fontSize: clampNumber(style.fontSize, DEFAULT_SUBTITLE_STYLE.fontSize, 24, 96),
    fontWeight: weight,
    fontFamily: customFont
      ? (typeof style.fontFamily === 'string' && style.fontFamily.trim() ? style.fontFamily.trim() : customFont.fileName)
      : DEFAULT_SUBTITLE_STYLE.fontFamily,
    fontFile: customFont?.filePath ?? SUBTITLE_BUILTIN_FONT.filePath,
    ...(customFont ? { customFont } : {}),
    ...(fontAssets.length ? { fontAssets } : {}),
    textColor: color(style.textColor, DEFAULT_SUBTITLE_STYLE.textColor),
    backgroundColor: color(style.backgroundColor, DEFAULT_SUBTITLE_STYLE.backgroundColor),
    backgroundOpacity: clampNumber(style.backgroundOpacity, DEFAULT_SUBTITLE_STYLE.backgroundOpacity, 0, 100),
    borderColor: color(style.borderColor, DEFAULT_SUBTITLE_STYLE.borderColor),
    borderWidth: clampNumber(style.borderWidth, DEFAULT_SUBTITLE_STYLE.borderWidth, 0, 12),
    cornerRadius: clampNumber(style.cornerRadius, DEFAULT_SUBTITLE_STYLE.cornerRadius, 0, 80),
    positionY: clampNumber(style.positionY, DEFAULT_SUBTITLE_STYLE.positionY, 50, 94),
  }
}

export function normalizeSubtitleCues(value: unknown, maxEndMs = Number.MAX_SAFE_INTEGER): WorkspaceSubtitleCue[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.flatMap((raw, index): WorkspaceSubtitleCue[] => {
    if (!raw || typeof raw !== 'object') return []
    const cue = raw as Partial<WorkspaceSubtitleCue>
    const text = typeof cue.text === 'string' ? cue.text.trim().replace(/\r?\n+/g, ' ') : ''
    const startMs = Math.max(0, finiteInteger(cue.startMs, -1))
    const endMs = Math.min(maxEndMs, finiteInteger(cue.endMs, -1))
    if (!text || startMs < 0 || endMs <= startMs) return []
    const baseId = typeof cue.id === 'string' && cue.id.trim() ? cue.id.trim() : `subtitle-${index + 1}`
    let id = baseId
    let suffix = 2
    while (ids.has(id)) id = `${baseId}-${suffix++}`
    ids.add(id)
    return [{ id, startMs, endMs, text, source: cue.source === 'generated' ? 'generated' : 'edited' }]
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

export function normalizeSubtitleTrack(value: unknown): WorkspaceSubtitleTrack | undefined {
  if (!value || typeof value !== 'object') return undefined
  const track = value as Partial<WorkspaceSubtitleTrack>
  if (track.schemaVersion !== 1) return value as WorkspaceSubtitleTrack
  const rangeStart = Math.max(0, finiteInteger(track.sourceRange?.startMs, 0))
  const rangeEnd = Math.max(rangeStart + 1, finiteInteger(track.sourceRange?.endMs, Number.MAX_SAFE_INTEGER))
  const fingerprint = track.sourceFingerprint
  const language = typeof track.language === 'string' && track.language ? track.language : 'auto'
  const cues = normalizeSubtitleCues(track.cues, rangeEnd)
  return {
    schemaVersion: 1,
    enabled: track.enabled !== false,
    language,
    model: {
      id: typeof track.model?.id === 'string' ? track.model.id : 'unknown',
      version: typeof track.model?.version === 'string' ? track.model.version : 'unknown',
      sha256: typeof track.model?.sha256 === 'string' ? track.model.sha256 : '',
    },
    sourceRange: { startMs: rangeStart, endMs: rangeEnd },
    sourceFingerprint: {
      size: Math.max(0, finiteInteger(fingerprint?.size, 0)),
      modifiedAtMs: Math.max(0, Number(fingerprint?.modifiedAtMs) || 0),
    },
    cues: language.toLowerCase().startsWith('zh')
      ? cues.map((cue) => cue.source === 'generated'
        ? { ...cue, text: simplifyChineseText(cue.text) }
        : cue)
      : cues,
    style: normalizeSubtitleStyle(track.style),
    generatedAt: typeof track.generatedAt === 'string' ? track.generatedAt : new Date(0).toISOString(),
  }
}

function srtTime(milliseconds: number): string {
  const value = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor(value % 3_600_000 / 60_000)
  const seconds = Math.floor(value % 60_000 / 1_000)
  const millis = value % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function subtitleTrackToSrt(track: WorkspaceSubtitleTrack, range = track.sourceRange): string {
  const startMs = Math.max(0, Math.round(range.startMs))
  const endMs = Math.max(startMs, Math.round(range.endMs))
  const cues = normalizeSubtitleCues(track.cues, endMs).filter((cue) => cue.endMs > startMs && cue.startMs < endMs)
  return `${cues.map((cue, index) => {
    const start = Math.max(startMs, cue.startMs) - startMs
    const end = Math.min(endMs, cue.endMs) - startMs
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${cue.text}`
  }).join('\n\n')}\n`
}
