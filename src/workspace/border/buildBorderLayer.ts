import type { DeclarativeCompositionLayer, FramePreset, MediaMetadata, PreviewLayer } from '../../shared/types'
import type { BorderSettings } from '../shared/editPipeline'
import { getBorderLogo } from './logoAssets'

type PresetModuleValue = FramePreset | PresetModuleValue[] | { default?: PresetModuleValue }

const presetModules = import.meta.glob<PresetModuleValue>('./presets/*.json', {
  eager: true,
  import: 'default',
})

function normalizePresets(value: PresetModuleValue | undefined): FramePreset[] {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(normalizePresets)
  if ('default' in value && value.default) return normalizePresets(value.default)
  const candidate = value as Partial<FramePreset>
  if (typeof candidate.id === 'string' && typeof candidate.name === 'string' && Array.isArray(candidate.layers)) {
    return [candidate as FramePreset]
  }
  console.warn('[FramePreset] 已忽略格式不正确的预设', value)
  return []
}

/** 支持单对象、数组及嵌套数组。文件按名称排序，数组保持文件内顺序。 */
export const FRAME_PRESETS = Object.entries(presetModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, preset]) => normalizePresets(preset))

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
    camera: [values.get('Model')].filter(Boolean).join(' ') || 'LUNA ULTRA',
    focalLength: values.get('FocalLengthIn35mmFormat') ? `${values.get('FocalLengthIn35mmFormat')}mm` : '—mm',
    aperture: values.get('FNumber') ? `f/${values.get('FNumber')}` : 'f/—',
    shutter,
    iso: values.get('ISO') ?? '—',
    date: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('zh-CN') : '',
    location: values.get('Location') ?? values.get('GPSPosition') ?? '',
    title: title.trim(),
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
  /** 当前素材。带 media 层的预设可借此重新安排照片在画布中的位置。 */
  mediaPath?: string | null
  mediaLayerStyle?: Pick<PreviewLayer, 'color' | 'transform' | 'lutId' | 'lutIntensity' | 'isVideo'>
}

/** JSON 预设直接转换为 wgpu 原生层，不在浏览器中进行任何栅格化。 */
export function buildBorderLayer({ canvasWidth, canvasHeight, border, metadata, mediaPath, mediaLayerStyle }: BuildBorderLayerOptions): PreviewLayer[] {
  if (!border.enabled) return []
  const preset = FRAME_PRESETS.find((item) => item.id === border.presetId) ?? FRAME_PRESETS[0]
  if (!preset) return []
  const variables = metadataVariables(metadata, border.title)
  if (!border.showDate) variables.date = ''
  const scale = border.frameSize / 100

  return preset.layers.flatMap((layer: DeclarativeCompositionLayer): PreviewLayer[] => {
    if (layer.visible === false || layer.type === 'group' || layer.type === 'decoration') return []
    if (layer.type === 'logo' && !border.showLogo) return []
    if (layer.id === 'title' && !border.showTitle) return []
    if ((layer.id === 'meta' || layer.id.includes('camera')) && !border.showCameraInfo) return []
    const h = Math.min(1, layer.rect.h * scale)
    const common = {
      filePath: '', dstX: layer.rect.x, dstY: Math.max(0, 1 - (1 - layer.rect.y) * scale), dstW: layer.rect.w, dstH: h,
      srcX: 0, srcY: 0, srcW: 1, srcH: 1, opacity: (layer.opacity ?? 1) * border.opacity / 100, zIndex: layer.zIndex,
    }
    if (layer.type === 'media') {
      if (!mediaPath) return []
      const baseTransform = mediaLayerStyle?.transform
      return [{
        ...common,
        ...mediaLayerStyle,
        layerType: 'media',
        filePath: mediaPath,
        fit: layer.fit === 'cover-scale' ? 'cover-scale' : 'cover',
        srcX: layer.crop?.x ?? 0,
        srcY: layer.crop?.y ?? 0,
        srcW: layer.crop?.w ?? 1,
        srcH: layer.crop?.h ?? 1,
        transform: {
          crop: baseTransform?.crop ?? null,
          orientation: baseTransform?.orientation ?? 0,
          rotate: baseTransform?.rotate ?? 0,
          flipH: baseTransform?.flipH ?? false,
          flipV: baseTransform?.flipV ?? false,
          scale: (baseTransform?.scale ?? 1) * border.mediaScale / 100,
          translateX: border.mediaOffsetX / 100,
          translateY: border.mediaOffsetY / 100,
        },
      }]
    }
    if (layer.type === 'shape') return [{ ...common, layerType: 'shape', shape: layer.shape, fillColor: layer.id === 'background' ? border.backgroundColor : layer.fill?.color, cornerRadius: layer.cornerRadius, strokeColor: layer.stroke?.color, strokeWidth: layer.stroke?.width }]
    if (layer.type === 'logo' && layer.source?.path) {
      const logo = getBorderLogo(layer.source.path)
      if (!logo) return []
      const targetPixelWidth = layer.rect.w * canvasWidth
      const targetPixelHeight = h * canvasHeight
      const targetAspect = targetPixelWidth / Math.max(1, targetPixelHeight)
      let dstX = layer.rect.x
      let dstY = common.dstY
      let dstW = layer.rect.w
      let dstH = h
      if (logo.aspectRatio > targetAspect) {
        dstH = targetPixelWidth / logo.aspectRatio / canvasHeight
        dstY += (h - dstH) / 2
      } else {
        dstW = targetPixelHeight * logo.aspectRatio / canvasWidth
        dstX += (layer.rect.w - dstW) / 2
      }
      return [{ ...common, layerType: 'media', filePath: logo.filePath, dstX, dstY, dstW, dstH }]
    }
    const content = template(layer.type === 'logo' ? layer.fallbackText ?? '' : layer.content, variables)
    const style = layer.type === 'text' ? layer.style : { fontFamily: 'Source Han Sans SC', fontFile: 'fonts/SourceHanSansSC-Bold.otf', fontSize: 18, fontWeight: 700, color: layer.tint?.color ?? border.textColor, align: 'left' as const }
    return [{ ...common, layerType: layer.type, content, fontSize: style.fontSize, fontFamily: style.fontFamily, fontFile: style.fontFile ?? 'fonts/SourceHanSansSC-Regular.otf', fontWeight: style.fontWeight, textColor: layer.type === 'logo' ? style.color : border.textColor, textAlign: style.align, verticalAlign: ('verticalAlign' in style ? style.verticalAlign : undefined) }]
  })
}
