import { execFile } from 'node:child_process'
import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { AiPersonEvidence, AiSelectionItem } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadModel } from './modelLoader'
import { loadVerifiedModelFile } from './modelFileService'
import { segmentSpecializedInWorker } from './specializedSegmentationService'

const FACE_MODEL = {
  fileName: 'model.onnx',
  url: 'https://media.githubusercontent.com/media/onnx/models/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx',
  mirrors: ['https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx'],
  sha256: '34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',
  sizeBytes: 1_270_727,
} as const

const EYE_MODEL = {
  fileName: 'model.onnx',
  url: 'https://storage.openvinotoolkit.org/repositories/open_model_zoo/public/2022.1/open-closed-eye-0001/open_closed_eye.onnx',
  sha256: '4daa100034482525a26c9afb9297c16580a531189e66e3d2b2ac7d32becfd593',
  sizeBytes: 46_164,
} as const

type Bounds = NonNullable<AiPersonEvidence['bounds']>

async function loadSelectionModel(id: string, definition: typeof FACE_MODEL | typeof EYE_MODEL, signal?: AbortSignal): Promise<string> {
  const directory = join(app.getPath('userData'), 'models', id)
  await mkdir(directory, { recursive: true })
  return loadVerifiedModelFile(directory, definition, { signal })
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

function maskComponents(mask: Buffer, size: number): Bounds[] {
  const visited = new Uint8Array(mask.length)
  const components: Bounds[] = []
  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || mask[start] < 128) continue
    const queue = [start]
    visited[start] = 1
    let minX = size
    let minY = size
    let maxX = -1
    let maxY = -1
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]
      const x = current % size
      const y = Math.floor(current / size)
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      for (const next of [current - 1, current + 1, current - size, current + size]) {
        if (next < 0 || next >= mask.length || visited[next] || mask[next] < 128) continue
        if ((next === current - 1 || next === current + 1) && Math.floor(next / size) !== y) continue
        visited[next] = 1
        queue.push(next)
      }
    }
    if (maxX >= minX && maxY >= minY) components.push({ x: minX / size, y: minY / size, width: (maxX - minX + 1) / size, height: (maxY - minY + 1) / size })
  }
  return components.sort((a, b) => b.width * b.height - a.width * a.height)
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

async function analyzeFaces(rgb: Buffer, layout: { scaledWidth: number; scaledHeight: number; padX: number; padY: number }, signal?: AbortSignal): Promise<Pick<AiPersonEvidence, 'faceCount' | 'primaryFaceBounds' | 'faceVisibility' | 'eyeState' | 'closedEyeConfidence'>> {
  const faceModel = await loadSelectionModel('ultraface-rfb-320', FACE_MODEL, signal)
  const result = await segmentSpecializedInWorker({ backend: 'ultraface', modelPath: faceModel, rgb, ...layout, outputSize: 256 }, signal)
  const faces = maskComponents(result.bytes, result.width)
  const primary = faces[0] ?? null
  if (!primary) return { faceCount: 0, primaryFaceBounds: null, faceVisibility: 'occluded', eyeState: 'unknown', closedEyeConfidence: null }
  if (primary.width < 0.085 || primary.height < 0.085) return { faceCount: faces.length, primaryFaceBounds: primary, faceVisibility: 'small', eyeState: 'unknown', closedEyeConfidence: null }
  const eyeCrops = (['left', 'right'] as const).map((side) => cropEye(rgb, primary, side, layout))
  const meanLuminance = eyeCrops.reduce((total, crop) => total + crop.reduce((sum, value) => sum + value, 0) / crop.length, 0) / eyeCrops.length
  if (meanLuminance < 52 || meanLuminance > 225) {
    return { faceCount: faces.length, primaryFaceBounds: primary, faceVisibility: 'clear', eyeState: 'unknown', closedEyeConfidence: null }
  }
  const eyeModel = await loadSelectionModel('open-closed-eye-0001', EYE_MODEL, signal)
  const probabilities = await Promise.all(eyeCrops.map(async (crop) => {
    const result = await segmentSpecializedInWorker({ backend: 'eye-state', modelPath: eyeModel, rgb: crop, scaledWidth: 32, scaledHeight: 32, padX: 0, padY: 0, outputSize: 1 }, signal)
    return result.bytes[0] / 255
  }))
  const [left, right] = probabilities
  const bothClosed = left >= 0.72 && right >= 0.72
  const bothOpen = left <= 0.35 && right <= 0.35
  const mixed = (left >= 0.72 && right <= 0.35) || (right >= 0.72 && left <= 0.35)
  return {
    faceCount: faces.length,
    primaryFaceBounds: primary,
    faceVisibility: 'clear',
    eyeState: bothClosed ? 'closed' : bothOpen ? 'open' : mixed ? 'mixed' : 'unknown',
    closedEyeConfidence: Number(((left + right) / 2).toFixed(3)),
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
    return { detected: false, coverage: 0, confidence: 0.8, subjectEdgeScore: null, bounds: null, faceCount: 0, primaryFaceBounds: null, faceVisibility: 'none', eyeState: 'unknown', closedEyeConfidence: null, reason: '没有识别到清晰的人物' }
  }
  const coverage = Number(evidence.coverage.toFixed(4))
  let faces: Awaited<ReturnType<typeof analyzeFaces>> = { faceCount: 0, primaryFaceBounds: null, faceVisibility: 'unknown', eyeState: 'unknown', closedEyeConfidence: null }
  try { faces = await analyzeFaces(rgb, layout, signal) } catch (error) { if (signal?.aborted) throw error }
  const faceReason = faces.eyeState === 'closed' ? '，检测到高可信闭眼' : faces.eyeState === 'mixed' ? '，双眼状态不一致，建议复查' : faces.faceVisibility === 'occluded' ? '，面部可能背向或被遮挡' : faces.faceVisibility === 'unknown' ? '，人脸细节暂不可用' : ''
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
