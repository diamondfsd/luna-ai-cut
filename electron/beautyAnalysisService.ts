import { execFile } from 'node:child_process'

import type { WorkspaceBeautyAnalysisResult } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadModel } from './modelLoader'
import { extractFaceBoxesInWorker, segmentSpecializedInWorker } from './specializedSegmentationService'

const INPUT_SIZE = 640
const MASK_SIZE = 512
const FACE_PARSE_SIZE = 512
const FACE_SKIN_LABELS = new Set([1, 7, 8, 10, 14])
const BODY_SKIN_LABELS = new Set([12, 13, 14, 15])

interface SourceLayout {
  scaledWidth: number
  scaledHeight: number
  padX: number
  padY: number
}

interface FaceBounds {
  x: number
  y: number
  width: number
  height: number
}

function decodeImage(filePath: string, signal: AbortSignal): Promise<{ rgb: Buffer; layout: SourceLayout }> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-i', filePath, '-frames:v', '1',
      '-vf', `scale=${INPUT_SIZE}:${INPUT_SIZE}:force_original_aspect_ratio=decrease:flags=bilinear,pad=${INPUT_SIZE}:${INPUT_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x727272`,
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ]
    execFile(getFfmpegPath(), args, {
      encoding: 'buffer',
      maxBuffer: INPUT_SIZE * INPUT_SIZE * 3 + 1024,
      signal,
    }, (error, stdout) => {
      if (error) return reject(error)
      const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
      if (rgb.byteLength !== INPUT_SIZE * INPUT_SIZE * 3) return reject(new Error('美颜分析画面读取不完整'))

      // 从填充色边缘反推有效图像区域，避免再次运行探测命令。
      let minX = INPUT_SIZE
      let minY = INPUT_SIZE
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < INPUT_SIZE; y += 1) {
        for (let x = 0; x < INPUT_SIZE; x += 1) {
          const offset = (y * INPUT_SIZE + x) * 3
          if (rgb[offset] === 0x72 && rgb[offset + 1] === 0x72 && rgb[offset + 2] === 0x72) continue
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
      const layout = maxX >= minX && maxY >= minY
        ? { scaledWidth: maxX - minX + 1, scaledHeight: maxY - minY + 1, padX: minX, padY: minY }
        : { scaledWidth: INPUT_SIZE, scaledHeight: INPUT_SIZE, padX: 0, padY: 0 }
      resolve({ rgb, layout })
    })
  })
}

function cropFace(rgb: Buffer, face: FaceBounds, layout: SourceLayout): { rgb: Buffer; x: number; y: number; side: number } {
  const centerX = layout.padX + (face.x + face.width / 2) * layout.scaledWidth
  const centerY = layout.padY + (face.y + face.height / 2) * layout.scaledHeight
  const side = Math.max(face.width * layout.scaledWidth, face.height * layout.scaledHeight) * 1.65
  const cropX = centerX - side / 2
  const cropY = centerY - side * 0.44
  const output = Buffer.alloc(FACE_PARSE_SIZE * FACE_PARSE_SIZE * 3)
  for (let y = 0; y < FACE_PARSE_SIZE; y += 1) {
    const sourceY = Math.max(0, Math.min(INPUT_SIZE - 1, Math.round(cropY + (y + 0.5) / FACE_PARSE_SIZE * side)))
    for (let x = 0; x < FACE_PARSE_SIZE; x += 1) {
      const sourceX = Math.max(0, Math.min(INPUT_SIZE - 1, Math.round(cropX + (x + 0.5) / FACE_PARSE_SIZE * side)))
      const sourceOffset = (sourceY * INPUT_SIZE + sourceX) * 3
      const targetOffset = (y * FACE_PARSE_SIZE + x) * 3
      output[targetOffset] = rgb[sourceOffset]
      output[targetOffset + 1] = rgb[sourceOffset + 1]
      output[targetOffset + 2] = rgb[sourceOffset + 2]
    }
  }
  return { rgb: output, x: cropX, y: cropY, side }
}

function compositeFaceLabels(target: Uint8Array, labels: Buffer, crop: ReturnType<typeof cropFace>, layout: SourceLayout): void {
  for (let y = 0; y < FACE_PARSE_SIZE; y += 1) {
    for (let x = 0; x < FACE_PARSE_SIZE; x += 1) {
      if (!FACE_SKIN_LABELS.has(labels[y * FACE_PARSE_SIZE + x])) continue
      const inputX = crop.x + (x + 0.5) / FACE_PARSE_SIZE * crop.side
      const inputY = crop.y + (y + 0.5) / FACE_PARSE_SIZE * crop.side
      const targetX = Math.floor((inputX - layout.padX) / layout.scaledWidth * MASK_SIZE)
      const targetY = Math.floor((inputY - layout.padY) / layout.scaledHeight * MASK_SIZE)
      if (targetX >= 0 && targetX < MASK_SIZE && targetY >= 0 && targetY < MASK_SIZE) {
        target[targetY * MASK_SIZE + targetX] = 255
      }
    }
  }
}

function softenMask(input: Uint8Array): Uint8Array {
  const closed = new Uint8Array(input.length)
  for (let y = 1; y < MASK_SIZE - 1; y += 1) {
    for (let x = 1; x < MASK_SIZE - 1; x += 1) {
      let count = 0
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) count += input[(y + yy) * MASK_SIZE + x + xx] >= 128 ? 1 : 0
      }
      closed[y * MASK_SIZE + x] = count >= 4 ? 255 : 0
    }
  }
  const output = new Uint8Array(input.length)
  for (let y = 1; y < MASK_SIZE - 1; y += 1) {
    for (let x = 1; x < MASK_SIZE - 1; x += 1) {
      let sum = 0
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) sum += closed[(y + yy) * MASK_SIZE + x + xx]
      }
      output[y * MASK_SIZE + x] = Math.round(sum / 9)
    }
  }
  return output
}

function resizeContent(rgb: Buffer, layout: SourceLayout): Buffer {
  const output = Buffer.alloc(MASK_SIZE * MASK_SIZE * 3)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    const sourceY = Math.max(0, Math.min(INPUT_SIZE - 1,
      Math.floor(layout.padY + (y + 0.5) * layout.scaledHeight / MASK_SIZE)))
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const sourceX = Math.max(0, Math.min(INPUT_SIZE - 1,
        Math.floor(layout.padX + (x + 0.5) * layout.scaledWidth / MASK_SIZE)))
      const sourceOffset = (sourceY * INPUT_SIZE + sourceX) * 3
      const targetOffset = (y * MASK_SIZE + x) * 3
      output[targetOffset] = rgb[sourceOffset]
      output[targetOffset + 1] = rgb[sourceOffset + 1]
      output[targetOffset + 2] = rgb[sourceOffset + 2]
    }
  }
  return output
}

function bodySkinMask(labels: Buffer): Uint8Array {
  const output = new Uint8Array(MASK_SIZE * MASK_SIZE)
  for (let index = 0; index < output.length; index += 1) {
    if (BODY_SKIN_LABELS.has(labels[index])) output[index] = 255
  }
  return softenMask(output)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function analyzeBeauty(
  requestId: string,
  filePath: string,
  signal: AbortSignal,
  report?: (phase: 'model' | 'preparing' | 'recognizing', label: string, percent: number | null) => void,
): Promise<WorkspaceBeautyAnalysisResult> {
  const started = performance.now()
  report?.('model', '正在准备美颜模型', null)
  const modelStarted = performance.now()
  const [faceDetector, humanParser, faceParser] = await Promise.all([
    loadModel('ultraface-rfb-320', undefined, signal),
    loadModel('schp-atr-18-int8', undefined, signal),
    loadModel('face-parsing-resnet18', undefined, signal),
  ])
  const modelLoadMs = performance.now() - modelStarted
  signal.throwIfAborted()

  report?.('preparing', '正在读取图片', null)
  const prepareStarted = performance.now()
  const { rgb, layout } = await decodeImage(filePath, signal)
  const imagePrepareMs = performance.now() - prepareStarted

  report?.('recognizing', '正在识别人脸与皮肤', null)
  const inferenceStarted = performance.now()
  const humanRgb = resizeContent(rgb, layout)
  const [faces, humanResult] = await Promise.all([
    extractFaceBoxesInWorker(faceDetector.path, rgb, layout, signal),
    segmentSpecializedInWorker({
      backend: 'human-parsing', modelPath: humanParser.path, rgb: humanRgb,
      scaledWidth: MASK_SIZE, scaledHeight: MASK_SIZE, padX: 0, padY: 0, outputSize: MASK_SIZE,
    }, signal),
  ])
  if (faces.length === 0) throw new Error('未发现可处理的人脸')

  const faceMask = new Uint8Array(MASK_SIZE * MASK_SIZE)
  const processedFaces = faces.slice(0, 8)
  for (const face of processedFaces) {
    signal.throwIfAborted()
    const crop = cropFace(rgb, face, layout)
    const parsed = await segmentSpecializedInWorker({
      backend: 'face-parsing', modelPath: faceParser.path, rgb: crop.rgb,
      scaledWidth: FACE_PARSE_SIZE, scaledHeight: FACE_PARSE_SIZE, padX: 0, padY: 0, outputSize: FACE_PARSE_SIZE,
    }, signal)
    compositeFaceLabels(faceMask, parsed.bytes, crop, layout)
  }
  const softFaceMask = softenMask(faceMask)
  if (!softFaceMask.some((value) => value >= 128)) throw new Error('没有识别到可靠的面部皮肤')
  const skinMask = bodySkinMask(humanResult.bytes)
  const inferenceMs = performance.now() - inferenceStarted
  return {
    requestId,
    width: MASK_SIZE,
    height: MASK_SIZE,
    faceCount: processedFaces.length,
    faceMask: toArrayBuffer(softFaceMask),
    skinMask: toArrayBuffer(skinMask),
    performance: {
      modelLoadMs: Math.round(modelLoadMs),
      imagePrepareMs: Math.round(imagePrepareMs),
      inferenceMs: Math.round(inferenceMs),
      totalMs: Math.round(performance.now() - started),
    },
  }
}
