import type { CropRect } from '../shared/editPipeline'
import { clampCrop, frameAspect, maxCropInsideImage, moveCropInsideImage, sourceUvToFramePoint } from './cropGeometry'

export interface NormalizedSubjectBounds {
  x: number
  y: number
  width: number
  height: number
}

export function subjectBoundsFromInstances(
  instanceIds: Uint16Array,
  width: number,
  height: number,
): NormalizedSubjectBounds | null {
  if (width <= 0 || height <= 0 || instanceIds.length !== width * height) return null
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (instanceIds[y * width + x] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return null
  return {
    x: left / width,
    y: top / height,
    width: (right - left + 1) / width,
    height: (bottom - top + 1) / height,
  }
}

function frameBounds(
  bounds: NormalizedSubjectBounds,
  sourceAspect: number,
  orientation: number,
  rotate: number,
): NormalizedSubjectBounds {
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => sourceUvToFramePoint(point, sourceAspect, orientation, rotate))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.max(...xs) - left),
    height: Math.max(0, Math.max(...ys) - top),
  }
}

function preferredAxisOrigin(center: number, cropSize: number): number {
  const target = center < 0.43 ? 1 / 3 : center > 0.57 ? 2 / 3 : 1 / 2
  return center - cropSize * target
}

export function autoCropForSubject(options: {
  sourceAspect: number
  targetAspect: number
  orientation: number
  rotate: number
  subject: NormalizedSubjectBounds
}): CropRect {
  const constraint = {
    sourceAspect: options.sourceAspect,
    orientation: options.orientation,
    rotate: options.rotate,
    aspectRatio: options.targetAspect,
  }
  let crop = maxCropInsideImage(constraint)
  if (Math.abs(frameAspect(options.sourceAspect, options.orientation) - options.targetAspect) < 0.01) {
    crop = clampCrop({
      x: crop.x + crop.w * 0.05,
      y: crop.y + crop.h * 0.05,
      w: crop.w * 0.9,
      h: crop.h * 0.9,
    })
  }

  const subject = frameBounds(
    options.subject,
    options.sourceAspect,
    options.orientation,
    options.rotate,
  )
  const marginX = Math.min(0.08, Math.max(0.025, subject.width * 0.12))
  const marginY = Math.min(0.08, Math.max(0.025, subject.height * 0.12))
  const left = subject.x - marginX
  const right = subject.x + subject.width + marginX
  const top = subject.y - marginY
  const bottom = subject.y + subject.height + marginY
  const centerX = subject.x + subject.width / 2
  const centerY = subject.y + subject.height / 2

  let targetX = preferredAxisOrigin(centerX, crop.w)
  let targetY = preferredAxisOrigin(centerY, crop.h)
  if (right - left <= crop.w) targetX = Math.max(right - crop.w, Math.min(left, targetX))
  if (bottom - top <= crop.h) targetY = Math.max(bottom - crop.h, Math.min(top, targetY))
  return moveCropInsideImage(crop, targetX - crop.x, targetY - crop.y, constraint)
}
