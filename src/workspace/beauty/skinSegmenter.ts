import type { ImageSegmenter } from '@mediapipe/tasks-vision'

import { workspaceImageCache } from '../shared/imageCache'

const MASK_SIZE = 128
const BODY_SKIN_FALLBACK_INDEX = 2
const FACE_SKIN_FALLBACK_INDEX = 3

export interface BeautySkinMask {
  data: string
  width: number
  height: number
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

export async function detectBodySkinMask(filePath: string): Promise<BeautySkinMask> {
  const [segmenter, image] = await Promise.all([
    getSkinSegmenter(),
    workspaceImageCache.generate(filePath),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法分析这张图片')
  context.drawImage(image.previewBitmap, 0, 0, canvas.width, canvas.height)

  const result = segmenter.segment(canvas)
  const masks = result.confidenceMasks ?? []
  const labels = segmenter.getLabels()
  const bodyIndex = labelIndex(labels, 'body-skin', BODY_SKIN_FALLBACK_INDEX)
  const faceIndex = labelIndex(labels, 'face-skin', FACE_SKIN_FALLBACK_INDEX)
  const bodyMask = masks[bodyIndex]
  const faceMask = masks[faceIndex]
  if (!bodyMask || !faceMask) {
    masks.forEach((mask) => mask.close())
    return { data: '', width: 0, height: 0 }
  }

  const body = bodyMask.getAsFloat32Array()
  const face = faceMask.getAsFloat32Array()
  const sourceWidth = bodyMask.width
  const sourceHeight = bodyMask.height
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
  return { data: encodeBase64(output), width: MASK_SIZE, height: MASK_SIZE }
}
