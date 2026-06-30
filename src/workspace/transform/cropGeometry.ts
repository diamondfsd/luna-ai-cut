import type { CropRect } from '../shared/editPipeline'

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
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
  const sourceX = cos * px - sin * py
  const sourceY = sin * px + cos * py
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
