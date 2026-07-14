import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

import { workspaceImageCache } from '../shared/imageCache'
import type { BeautyFaceGeometry } from '../shared/editPipeline'

const MAX_DETECTION_SIDE = 1280
const MAX_FACES = 3

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
    radiusX: Math.max(0.006, (maxX - minX) * 0.62),
    radiusY: Math.max(0.004, (maxY - minY) * 1.05),
  }
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
  }
}

export async function detectBeautyFaces(filePath: string): Promise<BeautyFaceGeometry[]> {
  const [landmarker, image] = await Promise.all([
    getFaceLandmarker(),
    workspaceImageCache.generate(filePath),
  ])
  const scale = Math.min(1, MAX_DETECTION_SIDE / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法分析这张图片')
  context.drawImage(image.previewBitmap, 0, 0, canvas.width, canvas.height)
  return landmarker.detect(canvas).faceLandmarks
    .map(compactFace)
    .filter((face): face is BeautyFaceGeometry => face !== null)
    .slice(0, MAX_FACES)
}
