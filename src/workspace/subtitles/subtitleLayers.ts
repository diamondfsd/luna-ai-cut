import type { PreviewLayer, WorkspaceSubtitleTrack } from '../../shared/types'
import { normalizeSubtitleStyle } from '../../shared/subtitleTrack.ts'

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
    const content = wrapSubtitleText(cue.text)
    const lineCount = content.split('\n').length
    const textHeight = lineCount * style.fontSize * 1.22 / 1080
    const boxHeight = Math.min(0.4, Math.max(0.1, textHeight + 0.045))
    const boxWidth = style.width / 100
    const boxX = (1 - boxWidth) / 2
    const boxY = Math.min(1 - boxHeight, Math.max(0, style.positionY / 100 - boxHeight / 2))
    const cornerRadius = Math.min(0.5, style.cornerRadius / Math.max(1, Math.min(boxWidth * canvas.width, boxHeight * canvas.height)))
    const horizontalPadding = Math.min(0.035, boxWidth * 0.05)
    const verticalPadding = Math.min(0.02, boxHeight * 0.16)
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
        dstX: boxX + horizontalPadding,
        dstY: boxY + verticalPadding,
        dstW: boxWidth - horizontalPadding * 2,
        dstH: boxHeight - verticalPadding * 2,
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
