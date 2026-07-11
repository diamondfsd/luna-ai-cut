import type { DeclarativeCompositionLayer, FramePreset, MediaMetadata, PreviewLayer } from '../../shared/types'
import type { BorderSettings } from '../shared/editPipeline'
import presetData from './frame-presets.json'

export const FRAME_PRESETS = presetData as FramePreset[]

function metadataVariables(metadata: MediaMetadata | null, title: string): Record<string, string> {
  const values = new Map<string, string>()
  for (const group of metadata?.groups ?? []) for (const entry of group.entries) values.set(entry.key, entry.value)
  const exposureValue = values.get('ExposureTime')
  const exposureNumber = Number(exposureValue)
  const shutter = exposureValue && Number.isFinite(exposureNumber) && exposureNumber > 0 && exposureNumber < 1
    ? `1/${Math.round(1 / exposureNumber)}s`
    : exposureValue ?? '—'
  const capturedAt = values.get('DateTimeOriginal') ?? values.get('ModifyDate')
  const date = capturedAt ? new Date(capturedAt) : null
  return {
    camera: [values.get('Make'), values.get('Model')].filter(Boolean).join(' ') || 'LUNA ULTRA',
    focalLength: values.get('FocalLengthIn35mmFormat') ? `${values.get('FocalLengthIn35mmFormat')}mm` : '—mm',
    aperture: values.get('FNumber') ? `f/${values.get('FNumber')}` : 'f/—',
    shutter,
    iso: values.get('ISO') ?? '—',
    date: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('zh-CN') : '',
    location: values.get('Location') ?? values.get('GPSPosition') ?? '',
    title: title.trim() || 'UNTITLED',
    sequence: '01',
  }
}

function template(content: string, variables: Record<string, string>): string {
  return content.replace(/{{\s*([\w]+)\s*}}/g, (_, key: string) => variables[key] ?? '').trim()
}

export interface BuildBorderLayerOptions {
  canvasWidth: number
  canvasHeight: number
  border: BorderSettings
  metadata: MediaMetadata | null
}

/** JSON 预设直接转换为 wgpu 原生层，不在浏览器中进行任何栅格化。 */
export function buildBorderLayer({ border, metadata }: BuildBorderLayerOptions): PreviewLayer[] {
  if (!border.enabled) return []
  const preset = FRAME_PRESETS.find((item) => item.id === border.presetId) ?? FRAME_PRESETS[0]
  if (!preset) return []
  const variables = metadataVariables(metadata, border.title)
  if (!border.showDate) variables.date = ''
  const scale = border.frameSize / 100

  return preset.layers.flatMap((layer: DeclarativeCompositionLayer): PreviewLayer[] => {
    if (layer.visible === false || layer.type === 'group' || layer.type === 'media' || layer.type === 'decoration') return []
    if (layer.type === 'logo' && !border.showLogo) return []
    if (layer.id === 'title' && !border.showTitle) return []
    if ((layer.id === 'meta' || layer.id.includes('camera')) && !border.showCameraInfo) return []
    const h = Math.min(1, layer.rect.h * scale)
    const common = {
      filePath: '', dstX: layer.rect.x, dstY: Math.max(0, 1 - (1 - layer.rect.y) * scale), dstW: layer.rect.w, dstH: h,
      srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: (layer.opacity ?? 1) * border.opacity / 100, zIndex: layer.zIndex,
    }
    if (layer.type === 'shape') return [{ ...common, layerType: 'shape', shape: layer.shape, fillColor: layer.id === 'background' ? border.backgroundColor : layer.fill?.color, cornerRadius: layer.cornerRadius, strokeColor: layer.stroke?.color, strokeWidth: layer.stroke?.width }]
    const content = template(layer.type === 'logo' ? layer.fallbackText ?? '' : layer.content, variables)
    const style = layer.type === 'text' ? layer.style : { fontFamily: 'Source Han Sans SC', fontFile: 'fonts/SourceHanSansSC-Bold.otf', fontSize: 18, fontWeight: 700, color: layer.tint?.color ?? border.textColor, align: 'left' as const }
    return [{ ...common, layerType: layer.type, content, fontSize: style.fontSize, fontFamily: style.fontFamily, fontFile: style.fontFile ?? 'fonts/SourceHanSansSC-Regular.otf', fontWeight: style.fontWeight, textColor: layer.type === 'logo' ? style.color : border.textColor, textAlign: style.align }]
  })
}
