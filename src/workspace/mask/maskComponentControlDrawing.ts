import type { ColorMaskComponent } from '../shared/editPipeline'
import { componentControlHandles, componentOutline, componentSoftness, componentSoftnessOutlines } from './maskComponentControls'

type VectorMaskComponent = Exclude<ColorMaskComponent, { type: 'raster' }>

export function drawMaskComponentControls(
  context: CanvasRenderingContext2D,
  component: VectorMaskComponent,
  toDisplay: (point: { x: number; y: number }) => { x: number; y: number },
  pixelRatio: number,
): void {
  const outline = componentOutline(component).map(toDisplay)
  const softness = component.type === 'linear-gradient' ? 0 : componentSoftness(component)
  const softnessOutlines = component.type !== 'linear-gradient' && softness > 0
    ? componentSoftnessOutlines(component)
    : null

  context.save()
  if (softnessOutlines) {
    for (const sourceOutline of [softnessOutlines.inner, softnessOutlines.outer]) {
      const softnessOutline = sourceOutline.map(toDisplay)
      context.strokeStyle = 'rgba(0, 0, 0, 0.82)'
      context.lineWidth = 2 * pixelRatio
      context.setLineDash([5 * pixelRatio, 4 * pixelRatio])
      context.beginPath()
      softnessOutline.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y))
      context.stroke()
      context.strokeStyle = '#f0a0cf'
      context.lineWidth = 1.1 * pixelRatio
      context.stroke()
    }
    context.setLineDash([])
  }

  context.strokeStyle = 'rgba(0, 0, 0, 0.82)'
  context.lineWidth = 2 * pixelRatio
  context.beginPath()
  outline.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y))
  context.stroke()
  context.strokeStyle = '#ffffff'
  context.lineWidth = 0.85 * pixelRatio
  context.stroke()

  for (const handle of componentControlHandles(component)) {
    const point = toDisplay(handle)
    context.beginPath()
    context.arc(point.x, point.y, (handle.kind === 'move' ? 4 : 5) * pixelRatio, 0, Math.PI * 2)
    context.fillStyle = handle.kind === 'rotate' ? '#0066cc' : handle.kind === 'feather' ? '#f05aad' : '#ffffff'
    context.fill()
    context.strokeStyle = '#111111'
    context.lineWidth = pixelRatio
    context.stroke()
  }
  context.restore()
}
