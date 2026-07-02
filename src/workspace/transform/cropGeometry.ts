import type { CropRect } from '../shared/editPipeline'

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export type CropDragMode = 'move' | 'rotate' | 'tl' | 'tr' | 'bl' | 'br' | 'top' | 'right' | 'bottom' | 'left'

export interface CropConstraintOptions {
  sourceAspect: number
  orientation: number
  rotate: number
  aspectRatio?: number | null
}

const MIN_CROP_SIZE = 0.05
const EPSILON = 0.0001

export function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360
}

export function normalizeFineRotate(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180
  return Math.round(normalized * 10) / 10
}

export function shouldSwapOrientation(orientation: number): boolean {
  const angle = ((orientation % 180) + 180) % 180
  return angle >= 45 && angle <= 135
}

export function frameAspect(sourceAspect: number, orientation: number): number {
  const safeAspect = Math.max(EPSILON, sourceAspect)
  return shouldSwapOrientation(orientation) ? 1 / safeAspect : safeAspect
}

export function frameSize(sourceAspect: number, orientation: number): Size {
  const safeAspect = Math.max(EPSILON, sourceAspect)
  return shouldSwapOrientation(orientation) ? { width: 1, height: safeAspect } : { width: safeAspect, height: 1 }
}

export function displayAspectForCrop(sourceAspect: number, orientation: number, crop: CropRect): number {
  return frameAspect(sourceAspect, orientation) * (Math.max(EPSILON, crop.w) / Math.max(EPSILON, crop.h))
}

export function cropForAspect(sourceAspect: number, orientation: number, targetAspect: number): CropRect {
  const ratio = Math.max(EPSILON, targetAspect) / Math.max(EPSILON, frameAspect(sourceAspect, orientation))
  if (ratio >= 1) {
    const h = Math.min(1, 1 / ratio)
    return { x: 0, y: (1 - h) / 2, w: 1, h }
  }
  return { x: (1 - ratio) / 2, y: 0, w: ratio, h: 1 }
}

export function clampCrop(crop: CropRect): CropRect {
  const w = Math.max(MIN_CROP_SIZE, Math.min(1, crop.w))
  const h = Math.max(MIN_CROP_SIZE, Math.min(1, crop.h))
  return {
    x: Math.max(0, Math.min(1 - w, crop.x)),
    y: Math.max(0, Math.min(1 - h, crop.y)),
    w,
    h,
  }
}

export function sameCrop(a: CropRect, b: CropRect): boolean {
  return Math.abs(a.x - b.x) < 0.0005 && Math.abs(a.y - b.y) < 0.0005 && Math.abs(a.w - b.w) < 0.0005 && Math.abs(a.h - b.h) < 0.0005
}

export function framePointToSourceUv(point: { x: number; y: number }, sourceAspect: number, orientation: number, rotate: number): { x: number; y: number } {
  const size = frameSize(sourceAspect, orientation)
  const radiansValue = ((orientation + rotate) * Math.PI) / 180
  const cos = Math.cos(radiansValue)
  const sin = Math.sin(radiansValue)
  const px = (point.x - 0.5) * size.width
  const py = (point.y - 0.5) * size.height
  const sourceX = cos * px + sin * py
  const sourceY = -sin * px + cos * py
  return {
    x: sourceX / Math.max(EPSILON, sourceAspect) + 0.5,
    y: sourceY + 0.5,
  }
}

export function isCropInsideImage(crop: CropRect, sourceAspect: number, orientation: number, rotate: number): boolean {
  const corners = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.w, y: crop.y },
    { x: crop.x, y: crop.y + crop.h },
    { x: crop.x + crop.w, y: crop.y + crop.h },
  ]
  return corners.every((corner) => {
    const uv = framePointToSourceUv(corner, sourceAspect, orientation, rotate)
    return uv.x >= -EPSILON && uv.x <= 1 + EPSILON && uv.y >= -EPSILON && uv.y <= 1 + EPSILON
  })
}

export function fitCropInsideImage(crop: CropRect, sourceAspect: number, orientation: number, rotate: number): CropRect {
  const clamped = clampCrop(crop)
  if (isCropInsideImage(clamped, sourceAspect, orientation, rotate)) return clamped
  const cx = clamped.x + clamped.w / 2
  const cy = clamped.y + clamped.h / 2
  let low = MIN_CROP_SIZE
  let high = 1
  let best = {
    ...clamped,
    w: Math.max(MIN_CROP_SIZE, clamped.w * low),
    h: Math.max(MIN_CROP_SIZE, clamped.h * low),
  }
  for (let i = 0; i < 20; i++) {
    const scale = (low + high) / 2
    const next = clampCrop({
      x: cx - (clamped.w * scale) / 2,
      y: cy - (clamped.h * scale) / 2,
      w: clamped.w * scale,
      h: clamped.h * scale,
    })
    if (isCropInsideImage(next, sourceAspect, orientation, rotate)) {
      best = next
      low = scale
    } else {
      high = scale
    }
  }
  return best
}

export function maxCropInsideImage(options: CropConstraintOptions): CropRect {
  const aspectInFrame = options.aspectRatio
    ? cropAspectInFrame(options.sourceAspect, options.orientation, options.aspectRatio)
    : 1
  const base = aspectInFrame >= 1
    ? { x: 0, y: (1 - 1 / aspectInFrame) / 2, w: 1, h: 1 / aspectInFrame }
    : { x: (1 - aspectInFrame) / 2, y: 0, w: aspectInFrame, h: 1 }
  if (isCropInsideImage(base, options.sourceAspect, options.orientation, options.rotate)) return base
  const center = { x: 0.5, y: 0.5 }
  let low = MIN_CROP_SIZE
  let high = 1
  let best = {
    x: center.x - (base.w * low) / 2,
    y: center.y - (base.h * low) / 2,
    w: base.w * low,
    h: base.h * low,
  }
  for (let i = 0; i < 28; i++) {
    const scale = (low + high) / 2
    const next = {
      x: center.x - (base.w * scale) / 2,
      y: center.y - (base.h * scale) / 2,
      w: base.w * scale,
      h: base.h * scale,
    }
    if (isCropInsideImage(next, options.sourceAspect, options.orientation, options.rotate)) {
      best = next
      low = scale
    } else {
      high = scale
    }
  }
  return best
}

export function containRect(containerW: number, containerH: number, contentAspect: number): Rect {
  const safeW = Math.max(1, containerW)
  const safeH = Math.max(1, containerH)
  const containerAspect = safeW / safeH
  const safeAspect = Math.max(EPSILON, contentAspect)
  if (containerAspect > safeAspect) {
    const width = safeH * safeAspect
    return { x: (safeW - width) / 2, y: 0, width, height: safeH }
  }
  const height = safeW / safeAspect
  return { x: 0, y: (safeH - height) / 2, width: safeW, height }
}

function cropAspectInFrame(sourceAspect: number, orientation: number, aspectRatio: number): number {
  return Math.max(EPSILON, aspectRatio) / Math.max(EPSILON, frameAspect(sourceAspect, orientation))
}

function interpolateCrop(a: CropRect, b: CropRect, t: number): CropRect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  }
}

function clampAspectSize(w: number, h: number, aspectInFrame: number): Size {
  let width = Math.max(MIN_CROP_SIZE, w)
  let height = Math.max(MIN_CROP_SIZE, h)
  if (width / height > aspectInFrame) {
    height = width / aspectInFrame
  } else {
    width = height * aspectInFrame
  }
  const scale = Math.min(1, 1 / Math.max(width, height))
  return { width: width * scale, height: height * scale }
}

function sourceUvCoefficients(
  offset: { x: number; y: number },
  sourceAspect: number,
  orientation: number,
  rotate: number,
): { ux: { a: number; b: number; c: number }; uy: { a: number; b: number; c: number } } {
  const size = frameSize(sourceAspect, orientation)
  const radiansValue = ((orientation + rotate) * Math.PI) / 180
  const cos = Math.cos(radiansValue)
  const sin = Math.sin(radiansValue)
  const safeAspect = Math.max(EPSILON, sourceAspect)
  return {
    ux: {
      a: (cos * size.width) / safeAspect,
      b: (sin * size.height) / safeAspect,
      c: (cos * size.width * (offset.x - 0.5) + sin * size.height * (offset.y - 0.5)) / safeAspect + 0.5,
    },
    uy: {
      a: -sin * size.width,
      b: cos * size.height,
      c: -sin * size.width * (offset.x - 0.5) + cos * size.height * (offset.y - 0.5) + 0.5,
    },
  }
}

function projectIntoHalfPlanes(point: { x: number; y: number }, crop: CropRect, options: CropConstraintOptions): { x: number; y: number } {
  const maxX = Math.max(0, 1 - crop.w)
  const maxY = Math.max(0, 1 - crop.h)
  const constraints: Array<{ a: number; b: number; c: number }> = [
    { a: -1, b: 0, c: 0 },
    { a: 0, b: -1, c: 0 },
    { a: 1, b: 0, c: maxX },
    { a: 0, b: 1, c: maxY },
  ]
  const offsets = [
    { x: 0, y: 0 },
    { x: crop.w, y: 0 },
    { x: 0, y: crop.h },
    { x: crop.w, y: crop.h },
  ]
  for (const offset of offsets) {
    const coeffs = sourceUvCoefficients(offset, options.sourceAspect, options.orientation, options.rotate)
    constraints.push({ a: coeffs.ux.a, b: coeffs.ux.b, c: 1 - coeffs.ux.c })
    constraints.push({ a: -coeffs.ux.a, b: -coeffs.ux.b, c: coeffs.ux.c })
    constraints.push({ a: coeffs.uy.a, b: coeffs.uy.b, c: 1 - coeffs.uy.c })
    constraints.push({ a: -coeffs.uy.a, b: -coeffs.uy.b, c: coeffs.uy.c })
  }

  let x = Math.max(0, Math.min(maxX, point.x))
  let y = Math.max(0, Math.min(maxY, point.y))
  for (let pass = 0; pass < 12; pass++) {
    for (const constraint of constraints) {
      const value = constraint.a * x + constraint.b * y
      if (value <= constraint.c + EPSILON) continue
      const denom = constraint.a * constraint.a + constraint.b * constraint.b
      if (denom <= EPSILON) continue
      const amount = (value - constraint.c) / denom
      x -= constraint.a * amount
      y -= constraint.b * amount
    }
    x = Math.max(0, Math.min(maxX, x))
    y = Math.max(0, Math.min(maxY, y))
  }
  return { x, y }
}

export function moveCropInsideImage(crop: CropRect, dx: number, dy: number, options: CropConstraintOptions): CropRect {
  const base = clampCrop(crop)
  const next = { ...base, x: base.x + dx, y: base.y + dy }
  if (isCropInsideImage(next, options.sourceAspect, options.orientation, options.rotate)) return clampCrop(next)
  const point = projectIntoHalfPlanes({ x: next.x, y: next.y }, base, options)
  return { ...base, x: point.x, y: point.y }
}

function resizeCandidate(crop: CropRect, mode: CropDragMode, dx: number, dy: number, aspectInFrame: number | null): CropRect {
  const start = clampCrop(crop)
  if (!aspectInFrame) {
    if (mode === 'tl') return clampCrop({ x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy })
    if (mode === 'tr') return clampCrop({ x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy })
    if (mode === 'bl') return clampCrop({ x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy })
    if (mode === 'br') return clampCrop({ ...start, w: start.w + dx, h: start.h + dy })
    if (mode === 'top') return clampCrop({ ...start, y: start.y + dy, h: start.h - dy })
    if (mode === 'right') return clampCrop({ ...start, w: start.w + dx })
    if (mode === 'bottom') return clampCrop({ ...start, h: start.h + dy })
    if (mode === 'left') return clampCrop({ ...start, x: start.x + dx, w: start.w - dx })
    return start
  }

  const right = start.x + start.w
  const bottom = start.y + start.h
  const centerX = start.x + start.w / 2
  const centerY = start.y + start.h / 2
  let width = start.w
  let height = start.h
  if (mode === 'left' || mode === 'tl' || mode === 'bl') width = start.w - dx
  if (mode === 'right' || mode === 'tr' || mode === 'br') width = start.w + dx
  if (mode === 'top') height = start.h - dy
  if (mode === 'bottom') height = start.h + dy
  if (mode === 'tl' || mode === 'tr' || mode === 'bl' || mode === 'br') {
    const horizontalWidth = Math.max(MIN_CROP_SIZE, width)
    const verticalHeight = Math.max(MIN_CROP_SIZE, mode === 'tl' || mode === 'tr' ? start.h - dy : start.h + dy)
    if (Math.abs(dx) >= Math.abs(dy)) {
      width = horizontalWidth
      height = width / aspectInFrame
    } else {
      height = verticalHeight
      width = height * aspectInFrame
    }
  } else {
    const size = mode === 'top' || mode === 'bottom' ? clampAspectSize(height * aspectInFrame, height, aspectInFrame) : clampAspectSize(width, width / aspectInFrame, aspectInFrame)
    width = size.width
    height = size.height
  }
  const size = clampAspectSize(width, height, aspectInFrame)
  width = size.width
  height = size.height

  if (mode === 'tl') return { x: right - width, y: bottom - height, w: width, h: height }
  if (mode === 'tr') return { x: start.x, y: bottom - height, w: width, h: height }
  if (mode === 'bl') return { x: right - width, y: start.y, w: width, h: height }
  if (mode === 'br') return { x: start.x, y: start.y, w: width, h: height }
  if (mode === 'left') return { x: right - width, y: centerY - height / 2, w: width, h: height }
  if (mode === 'right') return { x: start.x, y: centerY - height / 2, w: width, h: height }
  if (mode === 'top') return { x: centerX - width / 2, y: bottom - height, w: width, h: height }
  if (mode === 'bottom') return { x: centerX - width / 2, y: start.y, w: width, h: height }
  return start
}

export function resizeCropInsideImage(crop: CropRect, mode: CropDragMode, dx: number, dy: number, options: CropConstraintOptions): CropRect {
  const aspectInFrame = options.aspectRatio ? cropAspectInFrame(options.sourceAspect, options.orientation, options.aspectRatio) : null
  const start = clampCrop(crop)
  const candidate = resizeCandidate(start, mode, dx, dy, aspectInFrame)
  const constrained = clampCrop(candidate)
  if (isCropInsideImage(constrained, options.sourceAspect, options.orientation, options.rotate)) return constrained
  let low = 0
  let high = 1
  let best = start
  for (let i = 0; i < 24; i++) {
    const t = (low + high) / 2
    const next = clampCrop(interpolateCrop(start, constrained, t))
    if (isCropInsideImage(next, options.sourceAspect, options.orientation, options.rotate)) {
      best = next
      low = t
    } else {
      high = t
    }
  }
  return best
}
