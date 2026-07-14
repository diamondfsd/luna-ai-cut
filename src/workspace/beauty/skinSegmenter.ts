import type { ImageSegmenter } from '@mediapipe/tasks-vision'

import { workspaceImageCache } from '../shared/imageCache'

const MASK_SIZE = 128
const SEGMENTATION_INPUT_SIDE = 512
const BACKGROUND_FALLBACK_INDEX = 0
const BODY_SKIN_FALLBACK_INDEX = 2
const FACE_SKIN_FALLBACK_INDEX = 3

export interface BeautyPersonRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface BeautySkinMask {
  data: string
  width: number
  height: number
  personRegions: BeautyPersonRegion[]
}

let segmenterPromise: Promise<ImageSegmenter> | null = null

function assetUrl(relativePath: string): string {
  return new URL(relativePath, document.baseURI).href
}

async function getSkinSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(assetUrl('mediapipe/wasm'))
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: assetUrl('mediapipe/models/selfie_multiclass_256x256.tflite'),
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    })().catch((error) => {
      segmenterPromise = null
      throw error
    })
  }
  return segmenterPromise
}

function labelIndex(labels: string[], expected: string, fallback: number): number {
  const normalized = expected.replace(/[-_]/g, '').toLowerCase()
  const index = labels.findIndex((label) => (
    label.replace(/[-_ ]/g, '').toLowerCase() === normalized
  ))
  return index >= 0 ? index : fallback
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

function detectPersonRegions(background: Float32Array, width: number, height: number): BeautyPersonRegion[] {
  const visited = new Uint8Array(width * height)
  const minimumPixels = Math.max(16, Math.round(width * height * 0.00025))
  const regions: Array<BeautyPersonRegion & { pixels: number }> = []
  const stack: number[] = []

  for (let start = 0; start < background.length; start += 1) {
    if (visited[start] || 1 - background[start] < 0.38) continue
    visited[start] = 1
    stack.push(start)
    let pixels = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    while (stack.length > 0) {
      const index = stack.pop()!
      const x = index % width
      const y = Math.floor(index / width)
      pixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
          const next = nextY * width + nextX
          if (visited[next] || 1 - background[next] < 0.38) continue
          visited[next] = 1
          stack.push(next)
        }
      }
    }
    if (pixels < minimumPixels || maxX - minX < 3 || maxY - minY < 5) continue
    regions.push({
      x: minX / width,
      y: minY / height,
      width: (maxX - minX + 1) / width,
      height: (maxY - minY + 1) / height,
      pixels,
    })
  }
  return regions
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, 6)
    .map(({ x, y, width: regionWidth, height: regionHeight }) => ({ x, y, width: regionWidth, height: regionHeight }))
}

export async function detectBodySkinMask(filePath: string): Promise<BeautySkinMask> {
  const [segmenter, image] = await Promise.all([
    getSkinSegmenter(),
    workspaceImageCache.generate(filePath),
  ])
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, SEGMENTATION_INPUT_SIDE / Math.max(image.width, image.height))
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法分析这张图片')
  context.drawImage(image.previewBitmap, 0, 0, canvas.width, canvas.height)

  const result = segmenter.segment(canvas)
  const masks = result.confidenceMasks ?? []
  const labels = segmenter.getLabels()
  const backgroundIndex = labelIndex(labels, 'background', BACKGROUND_FALLBACK_INDEX)
  const bodyIndex = labelIndex(labels, 'body-skin', BODY_SKIN_FALLBACK_INDEX)
  const faceIndex = labelIndex(labels, 'face-skin', FACE_SKIN_FALLBACK_INDEX)
  const backgroundMask = masks[backgroundIndex]
  const bodyMask = masks[bodyIndex]
  const faceMask = masks[faceIndex]
  if (!backgroundMask || !bodyMask || !faceMask) {
    masks.forEach((mask) => mask.close())
    return { data: '', width: 0, height: 0, personRegions: [] }
  }

  const background = backgroundMask.getAsFloat32Array()
  const body = bodyMask.getAsFloat32Array()
  const face = faceMask.getAsFloat32Array()
  const sourceWidth = bodyMask.width
  const sourceHeight = bodyMask.height
  const personRegions = detectPersonRegions(background, sourceWidth, sourceHeight)
  const output = new Uint8Array(MASK_SIZE * MASK_SIZE)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / MASK_SIZE))
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / MASK_SIZE))
      const confidence = Math.max(body[sourceY * sourceWidth + sourceX], face[sourceY * sourceWidth + sourceX])
      const normalized = Math.max(0, Math.min(1, (confidence - 0.18) / 0.62))
      const softened = normalized * normalized * (3 - 2 * normalized)
      output[y * MASK_SIZE + x] = Math.round(softened * 255)
    }
  }
  masks.forEach((mask) => mask.close())
  return { data: encodeBase64(output), width: MASK_SIZE, height: MASK_SIZE, personRegions }
}
