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

export function componentSoftness(component: Exclude<ColorMaskComponent, { type: 'raster' | 'linear-gradient' }>): number {
  if (component.softness !== undefined) return Math.max(0, component.softness)
  if (component.featherX !== undefined || component.featherY !== undefined) {
    const x = Math.max(0, component.featherX ?? 0) / Math.max(component.width / 2, 0.00005)
    const y = Math.max(0, component.featherY ?? 0) / Math.max(component.height / 2, 0.00005)
    return (x + y) / 2
  }
  const legacyDistance = Math.max(0, component.feather) * Math.min(component.width, component.height) / 2
  return (legacyDistance / Math.max(component.width / 2, 0.00005)
    + legacyDistance / Math.max(component.height / 2, 0.00005)) / 2
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
  const rotate = rotatePoint(0, -component.height / 2 - 0.06, radians)
  const softnessScale = 1 + componentSoftness(component)
  const handles: MaskControlHandle[] = [
    { kind: 'rotate', x: component.centerX + rotate.x, y: component.centerY + rotate.y },
  ]
  const resizeUnit = component.type === 'rectangle' ? 1 : 1 / Math.SQRT2
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const point = rotatePoint(x * component.width / 2 * resizeUnit, y * component.height / 2 * resizeUnit, radians)
    handles.push({ kind: 'resize', x: component.centerX + point.x, y: component.centerY + point.y })
  }
  for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const point = rotatePoint(x * component.width / 2 * softnessScale, y * component.height / 2 * softnessScale, radians)
    handles.push({ kind: 'feather', x: component.centerX + point.x, y: component.centerY + point.y })
  }
  return handles
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
    const normalizedDistance = component.type === 'rectangle'
      ? Math.max(Math.abs(local.x) / Math.max(component.width / 2, 0.00005), Math.abs(local.y) / Math.max(component.height / 2, 0.00005))
      : Math.hypot(local.x / Math.max(component.width / 2, 0.00005), local.y / Math.max(component.height / 2, 0.00005))
    return {
      ...component,
      softness: Math.max(0, normalizedDistance - 1),
      featherX: undefined,
      featherY: undefined,
    }
  }
  const normalizedX = Math.abs(local.x) / Math.max(component.width / 2, 0.00005)
  const normalizedY = Math.abs(local.y) / Math.max(component.height / 2, 0.00005)
  const scale = Math.max(component.type === 'rectangle'
    ? Math.max(normalizedX, normalizedY)
    : Math.hypot(normalizedX, normalizedY), 0.001)
  const softness = componentSoftness(component)
  return {
    ...component,
    width: Math.max(0.001, component.width * scale),
    height: Math.max(0.001, component.height * scale),
    softness: softness > 0 ? Math.max(0, (1 + softness) / scale - 1) : 0,
    featherX: undefined,
    featherY: undefined,
  }
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

export function componentSoftnessOutlines(component: Exclude<ColorMaskComponent, { type: 'raster' }>): {
  inner: Array<{ x: number; y: number }>
  outer: Array<{ x: number; y: number }>
} {
  if (component.type === 'linear-gradient') {
    const outline = componentOutline(component)
    return { inner: outline, outer: outline }
  }
  const softness = componentSoftness(component)
  return {
    inner: componentOutline(component, Math.max(0, 1 - softness)),
    outer: componentOutline(component, 1 + softness),
  }
}
