import { execFile } from 'node:child_process'

import type { AiSelectionModelId } from '../src/shared/segmentationModels'
import type { AiPersonEvidence, AiSelectionItem } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadModel } from './modelLoader'
import { FACE_EMBEDDING_VERSION, hasSufficientFacePixels } from './aiSelectionFaceGroups'
import { extractFaceBoxesInWorker, extractFaceEmbeddingInWorker, segmentSpecializedInWorker } from './specializedSegmentationService'

type Bounds = NonNullable<AiPersonEvidence['bounds']>

async function loadSelectionModel(id: AiSelectionModelId, signal?: AbortSignal): Promise<string> {
  return (await loadModel(id, undefined, signal)).path
}

function decodePersonInput(item: AiSelectionItem, signal?: AbortSignal): Promise<Buffer> {
  const width = item.width ?? 640
  const height = item.height ?? 640
  const scale = Math.min(640 / width, 640 / height)
  const scaledWidth = Math.max(1, Math.round(width * scale))
  const scaledHeight = Math.max(1, Math.round(height * scale))
  const padX = Math.floor((640 - scaledWidth) / 2)
  const padY = Math.floor((640 - scaledHeight) / 2)
  const args = ['-v', 'error']
  if (item.kind === 'video') args.push('-ss', Math.max(0.1, Math.min(2, (item.duration ?? 1) * 0.08)).toFixed(3))
  args.push('-i', item.path, '-frames:v', '1', '-vf', `scale=${scaledWidth}:${scaledHeight}:flags=bilinear,pad=640:640:${padX}:${padY}:color=0x727272`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1')
  return new Promise((resolve, reject) => {
    execFile(getFfmpegPath(), args, { encoding: 'buffer', maxBuffer: 640 * 640 * 3 + 1024, signal }, (error, stdout) => {
      if (error) reject(error)
      else {
        const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
        if (rgb.byteLength !== 640 * 640 * 3) reject(new Error('人物分析画面读取不完整'))
        else resolve(rgb)
      }
    })
  })
}

function maskBounds(mask: Buffer, size: number): { coverage: number; bounds: AiPersonEvidence['bounds'] } {
  let count = 0
  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (mask[y * size + x] < 128) continue
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (count === 0 || maxX < minX || maxY < minY) return { coverage: 0, bounds: null }
  return {
    coverage: count / (size * size),
    bounds: {
      x: minX / size,
      y: minY / size,
      width: (maxX - minX + 1) / size,
      height: (maxY - minY + 1) / size,
    },
  }
}

function cropEye(rgb: Buffer, face: Bounds, side: 'left' | 'right', layout: { scaledWidth: number; scaledHeight: number; padX: number; padY: number }): Buffer {
  const size = 640
  const output = Buffer.alloc(32 * 32 * 3)
  const toInputX = (value: number): number => (layout.padX + value * layout.scaledWidth) / size
  const toInputY = (value: number): number => (layout.padY + value * layout.scaledHeight) / size
  const xStart = toInputX(face.x + face.width * (side === 'left' ? 0.08 : 0.52))
  const xEnd = toInputX(face.x + face.width * (side === 'left' ? 0.48 : 0.92))
  // UltraFace 框通常包含额头和下巴，眼睛中心位于框高约 55%。
  const yStart = toInputY(face.y + face.height * 0.4)
  const yEnd = toInputY(face.y + face.height * 0.7)
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const sourceX = Math.max(0, Math.min(size - 1, Math.floor((xStart + (x + 0.5) / 32 * (xEnd - xStart)) * size)))
      const sourceY = Math.max(0, Math.min(size - 1, Math.floor((yStart + (y + 0.5) / 32 * (yEnd - yStart)) * size)))
      rgb.copy(output, (y * 32 + x) * 3, (sourceY * size + sourceX) * 3, (sourceY * size + sourceX) * 3 + 3)
    }
  }
  return output
}

function cropFace(rgb: Buffer, face: Bounds, layout: { scaledWidth: number; scaledHeight: number; padX: number; padY: number }): Buffer {
  const outputSize = 112
  const centerX = layout.padX + (face.x + face.width / 2) * layout.scaledWidth
  const centerY = layout.padY + (face.y + face.height / 2) * layout.scaledHeight
  const side = Math.max(face.width * layout.scaledWidth, face.height * layout.scaledHeight) * 1.35
  const output = Buffer.alloc(outputSize * outputSize * 3)
  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = Math.max(0, Math.min(639, Math.round(centerX + (x / (outputSize - 1) - 0.5) * side)))
      const sourceY = Math.max(0, Math.min(639, Math.round(centerY + (y / (outputSize - 1) - 0.5) * side)))
      rgb.copy(output, (y * outputSize + x) * 3, (sourceY * 640 + sourceX) * 3, (sourceY * 640 + sourceX) * 3 + 3)
    }
  }
  return output
}

async function buildFaceDescriptors(rgb: Buffer, faces: Bounds[], layout: { scaledWidth: number; scaledHeight: number; padX: number; padY: number }, signal?: AbortSignal): Promise<NonNullable<AiPersonEvidence['faces']>> {
  const modelPath = await loadSelectionModel('sface-2021dec-int8', signal)
  const descriptors: NonNullable<AiPersonEvidence['faces']> = []
  for (const bounds of faces.slice(0, 8)) {
    if (!hasSufficientFacePixels(bounds, layout)) {
      descriptors.push({ bounds, embedding: null, embeddingVersion: null })
      continue
    }
    const values = await extractFaceEmbeddingInWorker(modelPath, cropFace(rgb, bounds, layout), signal)
    descriptors.push({
      bounds,
      embedding: values.map((value) => Math.max(-127, Math.min(127, Math.round(value * 127)))),
      embeddingVersion: FACE_EMBEDDING_VERSION,
    })
  }
  return descriptors
}

async function analyzeFaces(rgb: Buffer, layout: { scaledWidth: number; scaledHeight: number; padX: number; padY: number }, personBounds: Bounds, signal?: AbortSignal): Promise<Pick<AiPersonEvidence, 'faceCount' | 'primaryFaceBounds' | 'faceVisibility' | 'eyeState' | 'closedEyeConfidence' | 'faces'>> {
  const faceModel = await loadSelectionModel('ultraface-rfb-320', signal)
  const margin = 0.04
  const faces = (await extractFaceBoxesInWorker(faceModel, rgb, layout, signal)).filter((face) => {
    const centerX = face.x + face.width / 2
    const centerY = face.y + face.height / 2
    return centerX >= personBounds.x - margin
      && centerX <= personBounds.x + personBounds.width + margin
      && centerY >= personBounds.y - margin
      && centerY <= personBounds.y + personBounds.height + margin
  })
  const primary = faces[0] ?? null
  if (!primary) return { faceCount: 0, primaryFaceBounds: null, faceVisibility: 'occluded', eyeState: 'unknown', closedEyeConfidence: null, faces: [] }
  const descriptors = await buildFaceDescriptors(rgb, faces, layout, signal)
  if (primary.width < 0.12 || primary.height < 0.12) return { faceCount: faces.length, primaryFaceBounds: primary, faceVisibility: 'small', eyeState: 'unknown', closedEyeConfidence: null, faces: descriptors }
  const eyeCrops = (['left', 'right'] as const).map((side) => cropEye(rgb, primary, side, layout))
  const meanLuminance = eyeCrops.reduce((total, crop) => total + crop.reduce((sum, value) => sum + value, 0) / crop.length, 0) / eyeCrops.length
  if (meanLuminance < 52 || meanLuminance > 225) {
    return { faceCount: faces.length, primaryFaceBounds: primary, faceVisibility: 'clear', eyeState: 'unknown', closedEyeConfidence: null, faces: descriptors }
  }
  const eyeModel = await loadSelectionModel('open-closed-eye-0001', signal)
  const probabilities = await Promise.all(eyeCrops.map(async (crop) => {
    const result = await segmentSpecializedInWorker({ backend: 'eye-state', modelPath: eyeModel, rgb: crop, scaledWidth: 32, scaledHeight: 32, padX: 0, padY: 0, outputSize: 1 }, signal)
    return result.bytes[0] / 255
  }))
  const [left, right] = probabilities
  const bothClosed = left >= 0.82 && right >= 0.82
  const bothOpen = left <= 0.3 && right <= 0.3
  return {
    faceCount: faces.length,
    primaryFaceBounds: primary,
    faceVisibility: 'clear',
    eyeState: bothClosed ? 'closed' : bothOpen ? 'open' : 'unknown',
    closedEyeConfidence: Number(((left + right) / 2).toFixed(3)),
    faces: descriptors,
  }
}

function regionEdgeScore(rgb: Buffer, bounds: NonNullable<AiPersonEvidence['bounds']>): number {
  const size = 640
  const startX = Math.max(1, Math.floor(bounds.x * size))
  const endX = Math.min(size - 1, Math.ceil((bounds.x + bounds.width) * size))
  const startY = Math.max(1, Math.floor(bounds.y * size))
  const endY = Math.min(size - 1, Math.ceil((bounds.y + bounds.height) * size))
  const luma = (x: number, y: number): number => {
    const offset = (y * size + x) * 3
    return rgb[offset] * 0.2126 + rgb[offset + 1] * 0.7152 + rgb[offset + 2] * 0.0722
  }
  let total = 0
  let count = 0
  for (let y = startY; y < endY; y += 2) {
    for (let x = startX; x < endX; x += 2) {
      total += Math.abs(luma(x, y) - luma(x - 1, y)) + Math.abs(luma(x, y) - luma(x, y - 1))
      count += 2
    }
  }
  return Number((total / Math.max(1, count)).toFixed(2))
}

export async function analyzePersonEvidence(item: AiSelectionItem, signal?: AbortSignal): Promise<AiPersonEvidence> {
  signal?.throwIfAborted()
  const model = await loadModel('yolo26s-seg', undefined, signal)
  const rgb = await decodePersonInput(item, signal)
  const width = item.width ?? 640
  const height = item.height ?? 640
  const scale = Math.min(640 / width, 640 / height)
  const scaledWidth = Math.max(1, Math.round(width * scale))
  const scaledHeight = Math.max(1, Math.round(height * scale))
  const layout = { scaledWidth, scaledHeight, padX: Math.floor((640 - scaledWidth) / 2), padY: Math.floor((640 - scaledHeight) / 2) }
  const result = await segmentSpecializedInWorker({
    backend: 'yolo26-seg',
    modelPath: model.path,
    rgb,
    ...layout,
    outputSize: 512,
  }, signal)
  const evidence = maskBounds(result.bytes, result.width)
  if (!evidence.bounds || evidence.coverage < 0.002) {
    return { detected: false, coverage: 0, confidence: 0.8, subjectEdgeScore: null, bounds: null, faceCount: 0, primaryFaceBounds: null, faceVisibility: 'none', eyeState: 'unknown', closedEyeConfidence: null, faces: [], reason: '没有识别到清晰的人物' }
  }
  const coverage = Number(evidence.coverage.toFixed(4))
  let faces: Awaited<ReturnType<typeof analyzeFaces>> = { faceCount: 0, primaryFaceBounds: null, faceVisibility: 'unknown', eyeState: 'unknown', closedEyeConfidence: null, faces: [] }
  try { faces = await analyzeFaces(rgb, layout, evidence.bounds, signal) } catch (error) { if (signal?.aborted) throw error }
  const faceReason = faces.eyeState === 'closed' ? '，检测到高可信闭眼' : faces.faceVisibility === 'occluded' ? '，面部可能背向或被遮挡' : faces.faceVisibility === 'unknown' ? '，人脸细节暂不可用' : ''
  return {
    detected: true,
    coverage,
    confidence: 0.8,
    subjectEdgeScore: regionEdgeScore(rgb, evidence.bounds),
    bounds: evidence.bounds,
    ...faces,
    reason: `${coverage > 0.35 ? '人物占据画面主要位置' : coverage > 0.08 ? '找到清晰可比较的人物' : '找到画面中的人物'}${faceReason}`,
  }
}
