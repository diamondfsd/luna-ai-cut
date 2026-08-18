import type { CompositionLayer } from '../../shared/types'
import { filePathToPreviewUrl } from '../fileUtils'

export interface WebGpuRasterizedLayer {
  canvas: HTMLCanvasElement | OffscreenCanvas
  width: number
  height: number
}

type RasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function roundedRect(
  context: RasterContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const nextRadius = Math.min(Math.max(0, radius), Math.min(width, height) / 2)
  if (nextRadius <= 0) {
    context.rect(x, y, width, height)
    return
  }
  context.moveTo(x + nextRadius, y)
  context.arcTo(x + width, y, x + width, y + height, nextRadius)
  context.arcTo(x + width, y + height, x, y + height, nextRadius)
  context.arcTo(x, y + height, x, y, nextRadius)
  context.arcTo(x, y, x + width, y, nextRadius)
  context.closePath()
}

function drawShape(
  context: RasterContext,
  layer: CompositionLayer,
  width: number,
  height: number,
): void {
  const shape = layer.shape ?? 'rectangle'
  const fillColor = layer.fillColor
  const strokeColor = layer.strokeColor
  const strokeWidth = finiteNumber(layer.strokeWidth, 0)
  const radius = finiteNumber(layer.cornerRadius, 0)

  context.beginPath()
  if (shape === 'circle') {
    context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  } else if (shape === 'line') {
    context.moveTo(0, height / 2)
    context.lineTo(width, height / 2)
  } else if (shape === 'rounded-rectangle') {
    roundedRect(context, 0, 0, width, height, radius)
  } else {
    context.rect(0, 0, width, height)
  }

  if (fillColor && shape !== 'line') {
    context.fillStyle = fillColor
    context.fill()
  }
  if (strokeColor && strokeWidth > 0) {
    context.strokeStyle = strokeColor
    context.lineWidth = strokeWidth
    context.stroke()
  }
}

function wrapText(
  context: RasterContext,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let current = ''
    for (const character of paragraph) {
      const candidate = current + character
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current)
        current = character
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
  }
  return lines.length > 0 ? lines : ['']
}

function drawText(
  context: RasterContext,
  layer: CompositionLayer,
  width: number,
  height: number,
): void {
  const fontSize = Math.max(1, finiteNumber(layer.fontSize, 16))
  const fontWeight = Math.max(100, Math.min(900, Math.round(finiteNumber(layer.fontWeight, 400))))
  const fontFamily = layer.fontFamily?.trim() || 'sans-serif'
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  context.fillStyle = layer.textColor || '#ffffff'
  context.textAlign = layer.textAlign ?? 'left'
  context.textBaseline = 'alphabetic'

  const lineHeight = Math.max(fontSize, fontSize * 1.2)
  const lines = wrapText(context, layer.content ?? '', Math.max(1, width))
  const contentHeight = lines.length * lineHeight
  const verticalAlign = layer.verticalAlign ?? 'top'
  const firstBaseline = verticalAlign === 'middle'
    ? (height - contentHeight) / 2 + fontSize
    : verticalAlign === 'bottom'
      ? height - contentHeight + fontSize
      : fontSize
  const x = layer.textAlign === 'center'
    ? width / 2
    : layer.textAlign === 'right'
      ? width
      : 0

  for (const [index, line] of lines.entries()) {
    context.fillText(line, x, firstBaseline + index * lineHeight)
  }
}

const loadedFonts = new Map<string, Promise<void>>()

async function loadLayerFont(layer: CompositionLayer): Promise<void> {
  const fontSet = typeof document !== 'undefined'
    ? document.fonts
    : (globalThis as typeof globalThis & { fonts?: FontFaceSet }).fonts
  if (!layer.fontFile || typeof FontFace === 'undefined' || !fontSet) return
  const family = layer.fontFamily?.trim()
  if (!family) return
  const fontUrl = filePathToPreviewUrl(layer.fontFile) ?? layer.fontFile
  const key = `${family}\u0000${layer.fontFile}\u0000${layer.fontWeight ?? 400}`
  const existing = loadedFonts.get(key)
  if (existing) {
    await existing
    return
  }

  const loading = (async () => {
    try {
      const font = new FontFace(family, `url("${fontUrl.replaceAll('"', '%22')}")`, {
        weight: String(Math.max(100, Math.min(900, Math.round(finiteNumber(layer.fontWeight, 400))))),
      })
      await font.load()
      fontSet.add(font)
    } catch {
      // The browser or platform font loader may reject local resource URLs.
      // Canvas will use the declared family or its fallback in that case.
    }
  })()
  loadedFonts.set(key, loading)
  await loading
}

/** Rasterize a non-media layer into a canvas that exactly matches its target rect. */
export async function rasterizeWebGpuLayer(
  layer: CompositionLayer,
  canvasWidth: number,
  canvasHeight: number,
): Promise<WebGpuRasterizedLayer> {
  const width = Math.max(1, Math.round(Math.abs(layer.rect.w) * canvasWidth))
  const height = Math.max(1, Math.round(Math.abs(layer.rect.h) * canvasHeight))
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : new OffscreenCanvas(width, height)
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d') as RasterContext | null
  if (!context) throw new Error('无法创建图层绘制画布')

  context.clearRect(0, 0, width, height)
  context.globalAlpha = 1
  if (layer.layerType === 'shape') {
    drawShape(context, layer, width, height)
  } else if (layer.layerType === 'text' || layer.layerType === 'logo' || layer.layerType === 'decoration') {
    await loadLayerFont(layer)
    drawText(context, layer, width, height)
  }

  return { canvas, width, height }
}

export function hasRasterizableWebGpuLayerContent(layer: CompositionLayer): boolean {
  if (layer.layerType === 'shape') return true
  if (layer.layerType === 'text') return typeof layer.content === 'string'
  if (layer.layerType === 'logo' || layer.layerType === 'decoration') {
    return Boolean(layer.source.path) || typeof layer.content === 'string'
  }
  return false
}
