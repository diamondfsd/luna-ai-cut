import type { PreviewLayer } from '../shared/types'

const TEXT_VERTICAL_SAFETY = 1.18

export interface WebGpuTextRaster {
  width: number
  height: number
  rgba: Uint8Array
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function textColor(value: string | undefined): [number, number, number, number] {
  const hex = value?.trim().replace(/^#/, '')
  if (!hex || (hex.length !== 6 && hex.length !== 8) || !/^[0-9a-f]+$/i.test(hex)) return [1, 1, 1, 1]
  const byte = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return [byte(0), byte(2), byte(4), hex.length === 8 ? byte(6) : 1]
}

function cssFontFamily(family: string): string {
  return family
    .split(',')
    .map((item) => JSON.stringify(item.trim().replace(/"/g, '\\"')))
    .join(', ')
}

function setFont(context: CanvasRenderingContext2D, family: string, weight: number, size: number): void {
  context.font = `${weight} ${size}px ${cssFontFamily(family)}`
}

function fontMetrics(context: CanvasRenderingContext2D, lines: string[]): { width: number; lineHeight: number } {
  const sample = context.measureText('Hg')
  const ascent = sample.fontBoundingBoxAscent || sample.actualBoundingBoxAscent || 0
  const descent = sample.fontBoundingBoxDescent || sample.actualBoundingBoxDescent || 0
  const lineHeight = Math.max(1, ascent + descent)
  const width = lines.reduce((max, line) => Math.max(max, context.measureText(line).width), 0)
  return { width, lineHeight }
}

export function webGpuFontFamily(fontFile: string): string {
  let hash = 2166136261
  for (const character of fontFile) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619)
  return `LunaWebGpuFont${(hash >>> 0).toString(16)}`
}

export function rasterizeWebGpuText(
  layer: PreviewLayer,
  canvasWidth: number,
  canvasHeight: number,
  family: string,
): WebGpuTextRaster {
  const width = Math.max(2, Math.round(Math.abs(numberOr(layer.dstW, 1)) * canvasWidth))
  const height = Math.max(2, Math.round(Math.abs(numberOr(layer.dstH, 1)) * canvasHeight))
  const requestedFontPx = Math.max(5, numberOr(layer.fontSize, 16) * canvasHeight / 1080)
  const lines = (layer.content ?? '').split('\n')
  const weight = clamp(Math.round(numberOr(layer.fontWeight, 400)), 100, 900)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
  if (!context) throw new Error('无法准备 WebGPU 文字纹理')

  setFont(context, family, weight, requestedFontPx)
  const requested = fontMetrics(context, lines)
  const requestedLineAdvance = requested.lineHeight * TEXT_VERTICAL_SAFETY
  const requestedBlockHeight = (requested.lineHeight + requestedLineAdvance * Math.max(0, lines.length - 1)) * TEXT_VERTICAL_SAFETY
  const fitScale = Math.min(
    1,
    (width - 4) / Math.max(1, requested.width),
    (height - 4) / Math.max(1, requestedBlockHeight),
  )
  const fontPx = Math.max(5, requestedFontPx * Math.max(0.01, fitScale))
  setFont(context, family, weight, fontPx)
  const metrics = fontMetrics(context, lines)
  const lineAdvance = metrics.lineHeight * TEXT_VERTICAL_SAFETY
  const blockHeight = (metrics.lineHeight + lineAdvance * Math.max(0, lines.length - 1)) * TEXT_VERTICAL_SAFETY
  const blockTop = layer.verticalAlign === 'top'
    ? 2
    : layer.verticalAlign === 'bottom'
      ? Math.max(0, height - 2 - blockHeight)
      : Math.max(0, (height - blockHeight) * 0.5)
  const sample = context.measureText('Hg')
  const ascent = sample.fontBoundingBoxAscent || sample.actualBoundingBoxAscent || fontPx * 0.8
  const x = layer.textAlign === 'right' ? width - 2 : layer.textAlign === 'center' ? width * 0.5 : 2
  const align = layer.textAlign ?? 'left'
  const [red, green, blue, alpha] = textColor(layer.textColor)

  context.clearRect(0, 0, width, height)
  context.globalAlpha = 1
  context.fillStyle = `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`
  context.textAlign = align
  context.textBaseline = 'alphabetic'
  for (let index = 0; index < lines.length; index += 1) {
    context.fillText(lines[index] ?? '', x, blockTop + ascent + index * lineAdvance)
  }

  const source = context.getImageData(0, 0, width, height).data
  const rgba = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index += 4) {
    const coverage = (source[index + 3] ?? 0) / 255
    rgba[index] = Math.round((source[index] ?? 0) * coverage)
    rgba[index + 1] = Math.round((source[index + 1] ?? 0) * coverage)
    rgba[index + 2] = Math.round((source[index + 2] ?? 0) * coverage)
    rgba[index + 3] = source[index + 3] ?? 0
  }
  return { width, height, rgba }
}
