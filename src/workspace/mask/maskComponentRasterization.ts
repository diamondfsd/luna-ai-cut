import type { ColorMaskComponent, ColorMaskComponentOperation, ColorMaskLayer } from '../shared/editPipeline'
import { applyMaskSelectionOperation, resampleMask } from './maskSelectionOperations'

export type MaskRasterSource = (component: Extract<ColorMaskComponent, { type: 'raster' }>) => Uint8Array | null

export function editableMaskComponents(mask: ColorMaskLayer | null): ColorMaskComponent[] {
  if (mask?.components) return mask.components
  if (!mask?.path) return []
  return [{
    id: `component-base-${mask.id}`, type: 'raster', operation: 'replace', enabled: true, inverted: false,
    path: mask.path, width: mask.width, height: mask.height,
  }]
}

export function gradientTargetComponent(components: ColorMaskComponent[], active: ColorMaskComponent | null): ColorMaskComponent | null {
  if (active && active.type !== 'linear-gradient' && active.type !== 'radial-gradient') return active
  return [...components].reverse().find((item) => item.enabled && item.type !== 'linear-gradient' && item.type !== 'radial-gradient') ?? null
}

function componentValue(value: number, inverted: boolean): number {
  const byte = Math.max(0, Math.min(255, Math.round(value * 255)))
  return inverted ? 255 - byte : byte
}

export function rasterizeVectorComponent(width: number, height: number, component: Exclude<ColorMaskComponent, { type: 'raster' }>): Uint8Array {
  const result = new Uint8Array(width * height)
  if (component.type === 'linear-gradient') {
    const deltaX = component.endX - component.startX
    const deltaY = component.endY - component.startY
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const px = (x + 0.5) / width
        const py = (y + 0.5) / height
        const amount = lengthSquared <= 1e-8 ? 0 : Math.max(0, Math.min(1, ((px - component.startX) * deltaX + (py - component.startY) * deltaY) / lengthSquared))
        result[y * width + x] = componentValue(amount, component.inverted)
      }
    }
    return result
  }

  const radians = component.rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const radiusX = Math.max(0.00005, component.width / 2)
  const radiusY = Math.max(0.00005, component.height / 2)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5) / width - component.centerX
      const dy = (y + 0.5) / height - component.centerY
      const localX = (dx * cosine + dy * sine) / radiusX
      const localY = (-dx * sine + dy * cosine) / radiusY
      const distance = component.type === 'rectangle' ? Math.max(Math.abs(localX), Math.abs(localY)) : Math.hypot(localX, localY)
      let amount: number
      if (component.type === 'radial-gradient') {
        const inner = Math.max(0, 1 - component.feather)
        amount = distance <= inner ? 1 : component.feather <= 0 ? Number(distance <= 1) : Math.max(0, Math.min(1, (1 - distance) / component.feather))
      } else if (component.feather <= 0) {
        amount = Number(distance <= 1)
      } else {
        amount = Math.max(0, Math.min(1, (1 - distance) / component.feather))
      }
      result[y * width + x] = componentValue(amount, component.inverted)
    }
  }
  return result
}

function applyComponentOperation(base: Uint8Array, incoming: Uint8Array, operation: ColorMaskComponentOperation): Uint8Array {
  if (operation !== 'intersect') return applyMaskSelectionOperation(base, incoming, operation)
  const result = new Uint8Array(base.length)
  for (let index = 0; index < base.length; index += 1) result[index] = Math.round(base[index] * incoming[index] / 255)
  return result
}

export function composeMaskComponents(
  width: number,
  height: number,
  components: ColorMaskComponent[],
  rasterSource: MaskRasterSource,
): Uint8Array {
  let result = new Uint8Array(width * height)
  const modifiers = components.filter((component) => component.enabled
    && (component.type === 'linear-gradient' || component.type === 'radial-gradient')
    && component.targetComponentId)
  for (const component of components) {
    if (!component.enabled) continue
    if ((component.type === 'linear-gradient' || component.type === 'radial-gradient') && component.targetComponentId) continue
    let incoming: Uint8Array | null
    if (component.type === 'raster') {
      const source = rasterSource(component)
      incoming = source ? resampleMask(source, component.width, component.height, width, height) : null
      if (incoming && component.inverted) incoming = incoming.map((value) => 255 - value)
    } else {
      incoming = rasterizeVectorComponent(width, height, component)
    }
    if (!incoming) continue
    for (const modifier of modifiers) {
      if (modifier.targetComponentId !== component.id || modifier.type === 'raster') continue
      const gradient = rasterizeVectorComponent(width, height, modifier)
      incoming = applyComponentOperation(incoming, gradient, 'intersect')
    }
    result = applyComponentOperation(result, incoming, component.operation)
  }
  return result
}
