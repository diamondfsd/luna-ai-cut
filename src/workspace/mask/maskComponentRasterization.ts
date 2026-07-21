import type { ColorMaskComponent, ColorMaskComponentOperation, ColorMaskLayer } from '../shared/editPipeline'
import { resampleMask } from './maskSelectionOperations'

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

function applyVectorComponent(
  width: number,
  height: number,
  component: Exclude<ColorMaskComponent, { type: 'raster' }>,
  result: Uint8Array,
  operation: ColorMaskComponentOperation,
): void {
  if (component.type === 'linear-gradient') {
    const deltaX = component.endX - component.startX
    const deltaY = component.endY - component.startY
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const px = (x + 0.5) / width
        const py = (y + 0.5) / height
        const amount = lengthSquared <= 1e-8 ? 0 : Math.max(0, Math.min(1, ((px - component.startX) * deltaX + (py - component.startY) * deltaY) / lengthSquared))
        const index = y * width + x
        const incoming = componentValue(amount, component.inverted)
        if (operation === 'replace') result[index] = incoming
        else if (operation === 'add') result[index] = Math.max(result[index], incoming)
        else if (operation === 'subtract') result[index] = Math.round(result[index] * (255 - incoming) / 255)
        else result[index] = Math.round(result[index] * incoming / 255)
      }
    }
    return
  }

  const radians = component.rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const radiusX = Math.max(0.00005, component.width / 2)
  const radiusY = Math.max(0.00005, component.height / 2)
  let startX = 0
  let endX = width
  let startY = 0
  let endY = height
  if (!component.inverted && operation !== 'intersect') {
    const outerScale = 1 + component.feather
    const boundX = (Math.abs(cosine) * radiusX + Math.abs(sine) * radiusY) * outerScale
    const boundY = (Math.abs(sine) * radiusX + Math.abs(cosine) * radiusY) * outerScale
    startX = Math.max(0, Math.floor((component.centerX - boundX) * width))
    endX = Math.min(width, Math.ceil((component.centerX + boundX) * width))
    startY = Math.max(0, Math.floor((component.centerY - boundY) * height))
    endY = Math.min(height, Math.ceil((component.centerY + boundY) * height))
    if (operation === 'replace') result.fill(0)
  }
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const dx = (x + 0.5) / width - component.centerX
      const dy = (y + 0.5) / height - component.centerY
      const localX = (dx * cosine + dy * sine) / radiusX
      const localY = (-dx * sine + dy * cosine) / radiusY
      const distance = component.type === 'rectangle' ? Math.max(Math.abs(localX), Math.abs(localY)) : Math.hypot(localX, localY)
      let amount: number
      if (component.feather <= 0) {
        amount = Number(distance <= 1)
      } else {
        amount = distance <= 1 ? 1 : Math.max(0, Math.min(1, (1 + component.feather - distance) / component.feather))
      }
      const index = y * width + x
      const incoming = componentValue(amount, component.inverted)
      if (operation === 'replace') result[index] = incoming
      else if (operation === 'add') result[index] = Math.max(result[index], incoming)
      else if (operation === 'subtract') result[index] = Math.round(result[index] * (255 - incoming) / 255)
      else result[index] = Math.round(result[index] * incoming / 255)
    }
  }
}

export function rasterizeVectorComponent(width: number, height: number, component: Exclude<ColorMaskComponent, { type: 'raster' }>): Uint8Array {
  const result = new Uint8Array(width * height)
  applyVectorComponent(width, height, component, result, 'replace')
  return result
}

function applyComponentOperation(base: Uint8Array, incoming: Uint8Array, operation: ColorMaskComponentOperation): void {
  if (base.length !== incoming.length) throw new Error('蒙版尺寸不一致')
  if (operation === 'replace') {
    base.set(incoming)
    return
  }
  for (let index = 0; index < base.length; index += 1) {
    if (operation === 'add') base[index] = Math.max(base[index], incoming[index])
    else if (operation === 'subtract') base[index] = Math.round(base[index] * (255 - incoming[index]) / 255)
    else base[index] = Math.round(base[index] * incoming[index] / 255)
  }
}

export function composeMaskComponents(
  width: number,
  height: number,
  components: ColorMaskComponent[],
  rasterSource: MaskRasterSource,
): Uint8Array {
  const result = new Uint8Array(width * height)
  const modifiers = components.filter((component) => component.enabled
    && (component.type === 'linear-gradient' || component.type === 'radial-gradient')
    && component.targetComponentId)
  const modifiersByTarget = new Map<string, typeof modifiers>()
  for (const modifier of modifiers) {
    const targetModifiers = modifiersByTarget.get(modifier.targetComponentId!) ?? []
    targetModifiers.push(modifier)
    modifiersByTarget.set(modifier.targetComponentId!, targetModifiers)
  }
  for (const component of components) {
    if (!component.enabled) continue
    if ((component.type === 'linear-gradient' || component.type === 'radial-gradient') && component.targetComponentId) continue
    const componentModifiers = modifiersByTarget.get(component.id) ?? []
    if (component.type !== 'raster' && componentModifiers.length === 0) {
      applyVectorComponent(width, height, component, result, component.operation)
      continue
    }
    let incoming: Uint8Array | null
    if (component.type === 'raster') {
      const source = rasterSource(component)
      incoming = source ? resampleMask(source, component.width, component.height, width, height) : null
      if (incoming && component.inverted) incoming = incoming.map((value) => 255 - value)
    } else {
      incoming = rasterizeVectorComponent(width, height, component)
    }
    if (!incoming) continue
    for (const modifier of componentModifiers) {
      if (modifier.type === 'raster') continue
      const gradient = rasterizeVectorComponent(width, height, modifier)
      applyComponentOperation(incoming, gradient, 'intersect')
    }
    applyComponentOperation(result, incoming, component.operation)
  }
  return result
}

export function composeBaseSelectionComponents(
  width: number,
  height: number,
  components: ColorMaskComponent[],
  rasterSource: MaskRasterSource,
): Uint8Array {
  return composeMaskComponents(
    width,
    height,
    components.filter((component) => component.type !== 'linear-gradient' && component.type !== 'radial-gradient'),
    rasterSource,
  )
}
