import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

import { workspaceImageCache } from '../shared/imageCache'
import type { BeautyFaceGeometry } from '../shared/editPipeline'
import type { BeautyPersonRegion } from './skinSegmenter'

const MAX_DETECTION_SIDE = 2560
const MAX_FACES = 3
const FACE_CONTOUR_POINT_COUNT = 24
const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454,
  323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132,
  93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const
const PROFILE_SUPPORT_INDICES = [1, 2, 98, 327] as const

let landmarkerPromise: Promise<FaceLandmarker> | null = null

function assetUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).href
}

async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(assetUrl('mediapipe/wasm'))
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: assetUrl('mediapipe/models/face_landmarker.task'),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        numFaces: MAX_FACES,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
      })
    })().catch((error) => {
      landmarkerPromise = null
      throw error
    })
  }
  return landmarkerPromise
}

function average(points: NormalizedLandmark[], indices: number[]): { x: number; y: number } {
  const valid = indices.map((index) => points[index]).filter(Boolean)
  if (valid.length === 0) return { x: 0, y: 0 }
  return {
    x: valid.reduce((sum, point) => sum + point.x, 0) / valid.length,
    y: valid.reduce((sum, point) => sum + point.y, 0) / valid.length,
  }
}

function bounds(points: NormalizedLandmark[], indices: number[]): { centerX: number; centerY: number; radiusX: number; radiusY: number } {
  const valid = indices.map((index) => points[index]).filter(Boolean)
  const xs = valid.map((point) => point.x)
  const ys = valid.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    radiusX: Math.max(0.004, (maxX - minX) * 0.5),
    radiusY: Math.max(0.003, (maxY - minY) * 0.5),
  }
}

function convexHull(points: NormalizedLandmark[]): NormalizedLandmark[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 2) return sorted
  const cross = (origin: NormalizedLandmark, a: NormalizedLandmark, b: NormalizedLandmark) => (
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
  )
  const lower: NormalizedLandmark[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: NormalizedLandmark[] = []
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function resampleClosedContour(points: NormalizedLandmark[], count: number): number[] {
  if (points.length < 3) return []
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    return Math.hypot(next.x - point.x, next.y - point.y)
  })
  const perimeter = lengths.reduce((sum, length) => sum + length, 0)
  if (perimeter <= 0) return []
  const contour: number[] = []
  let edgeIndex = 0
  let edgeStartDistance = 0
  for (let index = 0; index < count; index += 1) {
    const targetDistance = perimeter * index / count
    while (edgeIndex < lengths.length - 1 && edgeStartDistance + lengths[edgeIndex] < targetDistance) {
      edgeStartDistance += lengths[edgeIndex]
      edgeIndex += 1
    }
    const start = points[edgeIndex]
    const end = points[(edgeIndex + 1) % points.length]
    const ratio = lengths[edgeIndex] > 0 ? (targetDistance - edgeStartDistance) / lengths[edgeIndex] : 0
    contour.push(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio)
  }
  return contour
}

function encodeLandmarkMesh(points: NormalizedLandmark[]): string {
  const bytes = new Uint8Array(points.length * 4)
  const view = new DataView(bytes.buffer)
  points.forEach((point, index) => {
    view.setUint16(index * 4, Math.round(Math.max(0, Math.min(1, point.x)) * 65535), true)
    view.setUint16(index * 4 + 2, Math.round(Math.max(0, Math.min(1, point.y)) * 65535), true)
  })
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

function clampRegion(region: BeautyPersonRegion): BeautyPersonRegion {
  const x = Math.max(0, Math.min(1, region.x))
  const y = Math.max(0, Math.min(1, region.y))
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, region.width)),
    height: Math.max(0.01, Math.min(1 - y, region.height)),
  }
}

function expandPersonRegion(region: BeautyPersonRegion, headOnly: boolean): BeautyPersonRegion {
  const paddingX = region.width * 0.16
  const paddingTop = region.height * 0.08
  const x = region.x - paddingX
  const y = region.y - paddingTop
  const width = region.width + paddingX * 2
  const height = headOnly ? region.height * 0.62 + paddingTop : region.height + paddingTop * 1.6
  return clampRegion({ x, y, width, height })
}

async function detectFacesInRegion(
  landmarker: FaceLandmarker,
  image: Awaited<ReturnType<typeof workspaceImageCache.generate>>,
  requestedRegion: BeautyPersonRegion,
): Promise<NormalizedLandmark[][]> {
  const region = clampRegion(requestedRegion)
  const sourceX = Math.floor(region.x * image.width)
  const sourceY = Math.floor(region.y * image.height)
  const sourceWidth = Math.max(1, Math.min(image.width - sourceX, Math.ceil(region.width * image.width)))
  const sourceHeight = Math.max(1, Math.min(image.height - sourceY, Math.ceil(region.height * image.height)))
  const scale = Math.min(1, MAX_DETECTION_SIDE / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法分析这张图片')
  context.drawImage(
    image.previewBitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  const mappedRegion = {
    x: sourceX / image.width,
    y: sourceY / image.height,
    width: sourceWidth / image.width,
    height: sourceHeight / image.height,
  }
  return landmarker.detect(canvas).faceLandmarks.map((points) => points.map((point) => ({
    ...point,
    x: mappedRegion.x + point.x * mappedRegion.width,
    y: mappedRegion.y + point.y * mappedRegion.height,
  })))
}

function compactFace(points: NormalizedLandmark[]): BeautyFaceGeometry | null {
  const top = points[10]
  const bottom = points[152]
  const left = points[234]
  const right = points[454]
  if (!top || !bottom || !left || !right) return null

  const center = average(points, [10, 152, 234, 454, 1])
  const leftEye = bounds(points, [33, 133, 160, 159, 158, 144, 145, 153])
  const rightEye = bounds(points, [263, 362, 387, 386, 385, 373, 374, 380])
  const mouth = bounds(points, [61, 291, 13, 14, 78, 308])
  const outlinePoints = [...FACE_OVAL_INDICES, ...PROFILE_SUPPORT_INDICES]
    .map((index) => points[index])
    .filter((point): point is NormalizedLandmark => Boolean(point))
  const contour = resampleClosedContour(convexHull(outlinePoints), FACE_CONTOUR_POINT_COUNT)
  if (contour.length !== FACE_CONTOUR_POINT_COUNT * 2) return null
  return {
    centerX: center.x,
    centerY: center.y,
    width: Math.max(0.01, Math.abs(right.x - left.x) * 1.08),
    height: Math.max(0.01, Math.abs(bottom.y - top.y) * 1.08),
    leftEyeX: leftEye.centerX,
    leftEyeY: leftEye.centerY,
    leftEyeRadiusX: leftEye.radiusX,
    leftEyeRadiusY: leftEye.radiusY,
    rightEyeX: rightEye.centerX,
    rightEyeY: rightEye.centerY,
    rightEyeRadiusX: rightEye.radiusX,
    rightEyeRadiusY: rightEye.radiusY,
    mouthX: mouth.centerX,
    mouthY: mouth.centerY,
    mouthRadiusX: mouth.radiusX,
    mouthRadiusY: mouth.radiusY,
    contour,
    landmarkMesh: encodeLandmarkMesh(points),
    landmarkCount: points.length,
  }
}

export async function detectBeautyFaces(filePath: string, personRegions: BeautyPersonRegion[] = []): Promise<BeautyFaceGeometry[]> {
  const [landmarker, image] = await Promise.all([
    getFaceLandmarker(),
    workspaceImageCache.generate(filePath),
  ])
  const detected: NormalizedLandmark[][] = []
  for (const personRegion of personRegions) {
    const headFaces = await detectFacesInRegion(landmarker, image, expandPersonRegion(personRegion, true))
    if (headFaces.length > 0) {
      detected.push(...headFaces)
    } else {
      detected.push(...await detectFacesInRegion(landmarker, image, expandPersonRegion(personRegion, false)))
    }
    if (detected.length >= MAX_FACES) break
  }
  if (detected.length === 0) {
    detected.push(...await detectFacesInRegion(landmarker, image, { x: 0, y: 0, width: 1, height: 1 }))
  }
  const faces = detected
    .map(compactFace)
    .filter((face): face is BeautyFaceGeometry => face !== null)
  const unique: BeautyFaceGeometry[] = []
  for (const face of faces) {
    const duplicate = unique.some((candidate) => (
      Math.hypot(face.centerX - candidate.centerX, face.centerY - candidate.centerY)
        < Math.min(face.width, candidate.width) * 0.3
    ))
    if (!duplicate) unique.push(face)
    if (unique.length >= MAX_FACES) break
  }
  return unique
}
