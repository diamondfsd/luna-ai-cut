import type { ColorMaskComponent } from '../shared/editPipeline'

export type MaskComponentDragKind = 'move' | 'resize' | 'rotate' | 'feather' | 'start' | 'end'

export interface MaskControlHandle {
  kind: MaskComponentDragKind
  x: number
  y: number
}

export function shouldShowComponentControls(manualTool: string, hasDraft: boolean): boolean {
  return hasDraft || manualTool === 'move'
}

function rotatePoint(x: number, y: number, radians: number): { x: number; y: number } {
  return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) }
}

export function componentControlHandles(component: ColorMaskComponent): MaskControlHandle[] {
  if (component.type === 'raster') return []
  if (component.type === 'linear-gradient') {
    return [
      { kind: 'start', x: component.startX, y: component.startY },
      { kind: 'move', x: (component.startX + component.endX) / 2, y: (component.startY + component.endY) / 2 },
      { kind: 'end', x: component.endX, y: component.endY },
    ]
  }
  const radians = component.rotation * Math.PI / 180
  const resize = rotatePoint(component.width / 2, component.height / 2, radians)
  const rotate = rotatePoint(0, -component.height / 2 - 0.06, radians)
  const feather = rotatePoint(component.width / 2 * (1 + component.feather), 0, radians)
  return [
    { kind: 'move', x: component.centerX, y: component.centerY },
    { kind: 'resize', x: component.centerX + resize.x, y: component.centerY + resize.y },
    { kind: 'rotate', x: component.centerX + rotate.x, y: component.centerY + rotate.y },
    { kind: 'feather', x: component.centerX + feather.x, y: component.centerY + feather.y },
  ]
}

export function hitTestComponentControl(component: ColorMaskComponent, point: { x: number; y: number }, tolerance: number): MaskComponentDragKind | null {
  const handle = componentControlHandles(component).find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= tolerance)
  if (handle) return handle.kind
  if (component.type === 'raster') return null
  if (component.type === 'linear-gradient') {
    const dx = component.endX - component.startX
    const dy = component.endY - component.startY
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - component.startX) * dx + (point.y - component.startY) * dy) / lengthSquared)) : 0
    return Math.hypot(point.x - (component.startX + dx * t), point.y - (component.startY + dy * t)) <= tolerance ? 'move' : null
  }
  const radians = -component.rotation * Math.PI / 180
  const local = rotatePoint(point.x - component.centerX, point.y - component.centerY, radians)
  const nx = local.x / Math.max(0.0001, component.width / 2)
  const ny = local.y / Math.max(0.0001, component.height / 2)
  const inside = component.type === 'rectangle' ? Math.max(Math.abs(nx), Math.abs(ny)) <= 1 : Math.hypot(nx, ny) <= 1
  return inside ? 'move' : null
}

export function updateComponentFromDrag(
  component: Exclude<ColorMaskComponent, { type: 'raster' }>,
  kind: MaskComponentDragKind,
  start: { x: number; y: number },
  current: { x: number; y: number },
): Exclude<ColorMaskComponent, { type: 'raster' }> {
  if (component.type === 'linear-gradient') {
    if (kind === 'start') return { ...component, startX: current.x, startY: current.y }
    if (kind === 'end') return { ...component, endX: current.x, endY: current.y }
    const dx = current.x - start.x
    const dy = current.y - start.y
    return { ...component, startX: component.startX + dx, startY: component.startY + dy, endX: component.endX + dx, endY: component.endY + dy }
  }
  if (kind === 'move') return { ...component, centerX: component.centerX + current.x - start.x, centerY: component.centerY + current.y - start.y }
  if (kind === 'rotate') {
    const angle = Math.atan2(current.y - component.centerY, current.x - component.centerX) * 180 / Math.PI + 90
    return { ...component, rotation: (angle + 360) % 360 }
  }
  const radians = -component.rotation * Math.PI / 180
  const local = rotatePoint(current.x - component.centerX, current.y - component.centerY, radians)
  if (kind === 'feather') {
    return { ...component, feather: Math.max(0, Math.min(3, Math.abs(local.x) / Math.max(0.0001, component.width / 2) - 1)) }
  }
  return { ...component, width: Math.max(0.001, Math.abs(local.x) * 2), height: Math.max(0.001, Math.abs(local.y) * 2) }
}

export function componentOutline(component: Exclude<ColorMaskComponent, { type: 'raster' }>, scale = 1): Array<{ x: number; y: number }> {
  if (component.type === 'linear-gradient') return [{ x: component.startX, y: component.startY }, { x: component.endX, y: component.endY }]
  const radians = component.rotation * Math.PI / 180
  const count = component.type === 'rectangle' ? 4 : 48
  const points: Array<{ x: number; y: number }> = []
  for (let index = 0; index <= count; index += 1) {
    const ratio = index % count / count
    let localX: number
    let localY: number
    if (component.type === 'rectangle') {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      ;[localX, localY] = corners[index % 4]
    } else {
      localX = Math.cos(ratio * Math.PI * 2)
      localY = Math.sin(ratio * Math.PI * 2)
    }
    const rotated = rotatePoint(localX * component.width / 2 * scale, localY * component.height / 2 * scale, radians)
    points.push({ x: component.centerX + rotated.x, y: component.centerY + rotated.y })
  }
  return points
}
