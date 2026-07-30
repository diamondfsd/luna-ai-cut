import type { PreviewLayer, WorkspaceSubtitleTrack } from '../../shared/types'

function wrapText(text: string): string {
  const compact = text.trim().replace(/\s+/g, ' ')
  if (compact.length <= 20) return compact
  const split = Math.min(20, Math.max(1, Math.ceil(compact.length / 2)))
  return `${compact.slice(0, split)}\n${compact.slice(split)}`
}

export function buildSubtitleLayers(
  track: WorkspaceSubtitleTrack | undefined,
  canvas: { width: number; height: number },
  range: { startMs: number; endMs: number },
): PreviewLayer[] {
  if (!track?.enabled || track.schemaVersion !== 1 || range.endMs <= range.startMs) return []
  const fontSize = Math.max(24, Math.round(Math.min(canvas.width, canvas.height) * 0.042))
  const cues = [...track.cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  return cues.flatMap((cue, index): PreviewLayer[] => {
    const startMs = Math.max(range.startMs, cue.startMs)
    const endMs = Math.min(range.endMs, cue.endMs, cues[index + 1]?.startMs ?? Number.MAX_SAFE_INTEGER)
    if (endMs <= startMs || !cue.text.trim()) return []
    const activeStart = (startMs - range.startMs) / 1_000
    const activeEnd = (endMs - range.startMs) / 1_000
    const common = { activeStart, activeEnd, filePath: '', isVideo: false, srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: 1 }
    return [
      {
        ...common,
        layerType: 'shape',
        fit: 'stretch',
        dstX: 0.1,
        dstY: 0.79,
        dstW: 0.8,
        dstH: 0.13,
        zIndex: 900 + index * 2,
        shape: 'rounded-rectangle',
        fillColor: '#000000B8',
        cornerRadius: Math.max(6, Math.round(fontSize * 0.3)),
      },
      {
        ...common,
        layerType: 'text',
        fit: 'stretch',
        dstX: 0.13,
        dstY: 0.8,
        dstW: 0.74,
        dstH: 0.11,
        zIndex: 901 + index * 2,
        content: wrapText(cue.text),
        fontSize,
        fontFamily: 'Source Han Sans SC',
        fontFile: 'fonts/SourceHanSansSC-Medium.otf',
        fontWeight: 500,
        textColor: '#FFFFFF',
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    ]
  })
}
