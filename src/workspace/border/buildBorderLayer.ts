import type { DeclarativeCompositionLayer, FramePreset, MediaMetadata, PreviewLayer } from '../../shared/types'
import { isVideoPath } from '../../lib/fileUtils'
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
  const dateParts = capturedAt?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/)
  const formattedDate = dateParts
    ? `${dateParts[1]}.${dateParts[2]}.${dateParts[3]}`
    : (() => {
        if (!capturedAt) return ''
        const date = new Date(capturedAt)
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN')
      })()
  return {
    camera: [values.get('Model')].filter(Boolean).join(' ') || 'LUNA ULTRA',
    focalLength: values.get('FocalLengthIn35mmFormat') ? `${values.get('FocalLengthIn35mmFormat')}mm` : '—mm',
    aperture: values.get('FNumber') ? `f/${values.get('FNumber')}` : 'f/—',
    shutter,
    iso: values.get('ISO') ?? '—',
    date: formattedDate,
    location: values.get('Location') ?? values.get('GPSPosition') ?? '',
    title: title.trim(),
    sequence: '01',
  }
}

function template(content: string, variables: Record<string, string>): string {
  return content
    .replace(/{{\s*([\w]+)\s*}}/g, (_, key: string) => variables[key] ?? '')
    .replace(/\s*([·|/])(?:\s*\1)+\s*/g, ' $1 ')
    .replace(/^\s*[·|/]\s*|\s*[·|/]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function videoTemplate(content: string): string {
  return content
    .replace(/ISO\s*{{\s*iso\s*}}/gi, '')
    .replace(/{{\s*(focalLength|aperture|shutter|iso)\s*}}/g, '')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 全画布纸张预设不再用“背景 + 重复素材层”盖住主素材。
 * 将背景拆成开口四周的四块实体边框，让底下唯一的素材层直接露出。
 */
function buildCutoutBackground(
  background: Extract<DeclarativeCompositionLayer, { type: 'shape' }>,
  media: Extract<DeclarativeCompositionLayer, { type: 'media' }>,
  border: BorderSettings,
): PreviewLayer[] {
  const borderScale = clamp(border.frameSize / 100, 0.1, 2)
  const left = clamp(media.rect.x * borderScale, 0, 0.475)
  const top = clamp(media.rect.y * borderScale, 0, 0.475)
  const right = clamp((1 - media.rect.x - media.rect.w) * borderScale, 0, 0.475)
  const bottom = clamp((1 - media.rect.y - media.rect.h) * borderScale, 0, 0.475)
  const opening = {
    x: left,
    y: top,
    w: 1 - left - right,
    h: 1 - top - bottom,
  }
  const rectangles = [
    { x: 0, y: 0, w: 1, h: opening.y },
    { x: 0, y: opening.y + opening.h, w: 1, h: 1 - opening.y - opening.h },
    { x: 0, y: opening.y, w: opening.x, h: opening.h },
    { x: opening.x + opening.w, y: opening.y, w: 1 - opening.x - opening.w, h: opening.h },
  ]

  const underlay: PreviewLayer = {
    layerType: 'shape',
    filePath: '',
    dstX: 0,
    dstY: 0,
    dstW: 1,
    dstH: 1,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    opacity: (background.opacity ?? 1) * border.opacity / 100,
    zIndex: -1,
    shape: 'rectangle',
    fillColor: border.backgroundColor,
  }
  const frame = rectangles
    .filter((rect) => rect.w > 0.0001 && rect.h > 0.0001)
    .map((rect): PreviewLayer => ({
      layerType: 'shape',
      filePath: '',
      dstX: rect.x,
      dstY: rect.y,
      dstW: rect.w,
      dstH: rect.h,
      srcX: 0,
      srcY: 0,
      srcW: 1,
      srcH: 1,
      opacity: (background.opacity ?? 1) * border.opacity / 100,
      zIndex: background.zIndex,
      shape: 'rectangle',
      fillColor: border.backgroundColor,
    }))
  return [underlay, ...frame]
}

export interface BuildBorderLayerOptions {
  canvasWidth: number
  canvasHeight: number
  border: BorderSettings
  metadata: MediaMetadata | null
  /** 当前素材。带 media 层的预设可借此重新安排照片在画布中的位置。 */
  mediaPath?: string | null
  mediaLayerStyle?: Pick<PreviewLayer, 'color' | 'transform' | 'restoreLutId' | 'lutId' | 'lutIntensity' | 'isVideo' | 'maskPath' | 'maskOpacity' | 'maskInverted' | 'maskFeather'>
}

/** JSON 预设直接转换为 wgpu 原生层，不在浏览器中进行任何栅格化。 */
export function buildBorderLayer({ canvasWidth, canvasHeight, border, metadata, mediaPath, mediaLayerStyle }: BuildBorderLayerOptions): PreviewLayer[] {
  if (!border.enabled) return []
  const preset = FRAME_PRESETS.find((item) => item.id === border.presetId) ?? FRAME_PRESETS[0]
  if (!preset) return []
  const variables = metadataVariables(metadata, border.title)
  if (!border.showDate) variables.date = ''
  // 含媒体层的预设是固定的全画布版式（如拍立得、卡纸），其 frameSize
  // 在开口边框生成时单独处理；底栏/浮层预设仍沿用纵向缩放逻辑。
  const hasMediaLayout = preset.layers.some((layer) => layer.type === 'media')
  const mediaLayout = preset.layers.find((layer) => layer.type === 'media')
  const cutoutBackground = preset.layers.find((layer) =>
    layer.type === 'shape'
    && layer.id === 'background'
    && layer.rect.x === 0
    && layer.rect.y === 0
    && layer.rect.w === 1
    && layer.rect.h === 1,
  )
  const usesCutoutLayout = mediaLayout?.type === 'media' && cutoutBackground?.type === 'shape'
  const scale = hasMediaLayout ? 1 : border.frameSize / 100
  const isVideoMedia = mediaPath ? isVideoPath(mediaPath) : false

  return preset.layers.flatMap((layer: DeclarativeCompositionLayer): PreviewLayer[] => {
    if (layer.visible === false || layer.type === 'group' || layer.type === 'decoration') return []
    if (layer.type === 'logo' && !border.showLogo) return []
    if (layer.id === 'title' && !border.showTitle) return []
    if ((layer.id === 'meta' || layer.id.includes('camera')) && !border.showCameraInfo) return []
    if (usesCutoutLayout && layer.type === 'media') return []
    if (usesCutoutLayout && layer === cutoutBackground) {
      return buildCutoutBackground(cutoutBackground, mediaLayout, border)
    }
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
      return [{
        ...common,
        layerType: 'media',
        filePath: logo.filePath,
        dstX,
        dstY,
        dstW,
        dstH,
        // 标明实际显示尺寸，让渲染器先用 Lanczos 预缩放 Logo，
        // 避免超大原图直接经 GPU 大比例缩小产生锯齿。
        positioning: {
          anchor: 'top-left',
          targetWidth: dstW,
          marginX: dstX,
          marginY: dstY,
        },
      }]
    }
    const rawContent = layer.type === 'logo' ? layer.fallbackText ?? '' : layer.content
    const content = template(isVideoMedia && layer.type === 'text' ? videoTemplate(rawContent) : rawContent, variables)
    const style = layer.type === 'text' ? layer.style : { fontFamily: 'Source Han Sans SC', fontFile: 'fonts/SourceHanSansSC-Bold.otf', fontSize: 18, fontWeight: 700, color: layer.tint?.color ?? border.textColor, align: 'left' as const }
    return [{ ...common, layerType: layer.type, content, fontSize: style.fontSize, fontFamily: style.fontFamily, fontFile: style.fontFile ?? 'fonts/SourceHanSansSC-Regular.otf', fontWeight: style.fontWeight, textColor: layer.type === 'logo' ? style.color : border.textColor, textAlign: style.align, verticalAlign: ('verticalAlign' in style ? style.verticalAlign : undefined) }]
  })
}
