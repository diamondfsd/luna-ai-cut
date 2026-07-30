import type { PreviewLayer, WorkspaceSubtitleTrack } from '../../shared/types'
import { normalizeSubtitleStyle } from '../../shared/subtitleTrack.ts'

const SUBTITLE_MAX_WIDTH_RATIO = 0.86

export function wrapSubtitleText(text: string, maxCharacters = 18): string {
  const compact = text.trim().replace(/\s+/g, ' ')
  const characters = Array.from(compact)
  if (characters.length <= maxCharacters) return compact
  const lines: string[] = []
  for (let offset = 0; offset < characters.length; offset += maxCharacters) {
    lines.push(characters.slice(offset, offset + maxCharacters).join(''))
  }
  return lines.join('\n')
}

function colorWithOpacity(color: string, opacity: number): string {
  const alpha = Math.round(Math.min(100, Math.max(0, opacity)) * 2.55)
  return `${color}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

function estimatedTextUnits(text: string): number {
  return Array.from(text).reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.35
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) return total + 1
    if (/[\u3000-\u303f\uff01-\uff60]/u.test(character)) return total + 0.9
    if (/[A-Za-z0-9]/u.test(character)) return total + 0.58
    return total + 0.55
  }, 0)
}

export function buildSubtitleLayers(
  track: WorkspaceSubtitleTrack | undefined,
  canvas: { width: number; height: number },
  range: { startMs: number; endMs: number },
): PreviewLayer[] {
  if (!track?.enabled || track.schemaVersion !== 1 || range.endMs <= range.startMs) return []
  const style = normalizeSubtitleStyle(track.style)
  const cues = [...track.cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  return cues.flatMap((cue, index): PreviewLayer[] => {
    const startMs = Math.max(range.startMs, cue.startMs)
    const endMs = Math.min(range.endMs, cue.endMs, cues[index + 1]?.startMs ?? Number.MAX_SAFE_INTEGER)
    if (endMs <= startMs || !cue.text.trim()) return []
    const activeStart = (startMs - range.startMs) / 1_000
    const activeEnd = (endMs - range.startMs) / 1_000
    const fontPx = style.fontSize * canvas.height / 1080
    const maxBoxWidthPx = SUBTITLE_MAX_WIDTH_RATIO * canvas.width
    const maxCharacters = Math.max(4, Math.min(18, Math.floor((maxBoxWidthPx - fontPx * 1.2) / Math.max(1, fontPx))))
    const content = wrapSubtitleText(cue.text, maxCharacters)
    const estimatedTextWidthPx = Math.max(...content.split('\n').map((line) => estimatedTextUnits(line) * fontPx))
    const boxWidthPx = Math.min(maxBoxWidthPx, Math.max(fontPx * 2.2, estimatedTextWidthPx + fontPx * 1.2))
    const lineCount = content.split('\n').length
    const textHeight = lineCount * style.fontSize * 1.22 / 1080
    const boxHeight = Math.min(0.4, Math.max(0.065, textHeight + style.fontSize * 0.45 / 1080))
    const boxWidth = boxWidthPx / canvas.width
    const boxX = (1 - boxWidth) / 2
    const boxY = Math.min(1 - boxHeight, Math.max(0, style.positionY / 100 - boxHeight / 2))
    const cornerRadius = Math.min(0.5, style.cornerRadius / Math.max(1, Math.min(boxWidth * canvas.width, boxHeight * canvas.height)))
    const common = { activeStart, activeEnd, filePath: '', isVideo: false, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1 }
    return [
      {
        ...common,
        layerType: 'shape',
        fit: 'stretch',
        dstX: boxX,
        dstY: boxY,
        dstW: boxWidth,
        dstH: boxHeight,
        zIndex: 900 + index * 2,
        shape: 'rounded-rectangle',
        fillColor: colorWithOpacity(style.backgroundColor, style.backgroundOpacity),
        cornerRadius,
        strokeColor: style.borderWidth > 0 ? style.borderColor : undefined,
        strokeWidth: style.borderWidth,
      },
      {
        ...common,
        layerType: 'text',
        fit: 'stretch',
        dstX: boxX,
        dstY: boxY,
        dstW: boxWidth,
        dstH: boxHeight,
        zIndex: 901 + index * 2,
        content,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontFile: style.fontFile,
        fontWeight: style.fontWeight,
        textColor: style.textColor,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    ]
  })
}
