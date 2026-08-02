import { execFile } from 'node:child_process'

import type { WorkspaceBeautyAnalysisResult } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadModel } from './modelLoader'
import { logMainInfo } from './loggerService'
import { extractFaceBoxesInWorker, segmentSpecializedInWorker } from './specializedSegmentationService'
import { detectFaceBlemishes } from './beautyBlemishDetection'

const INPUT_SIZE = 640
const MASK_SIZE = 1024
const FACE_PARSE_SIZE = 512
const HUMAN_PARSE_SIZE = 512
const FACE_SKIN_LABELS = new Set([1, 7, 8, 10, 14])
const FACE_EYE_LABELS = new Set([4, 5])
const FACE_MOUTH_LABELS = new Set([11, 12, 13])
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

interface FaceSkinAssessment {
  mask: Uint8Array | null
  skinRatio: number
  featureSamples: number
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
  const side = Math.max(face.width * layout.scaledWidth, face.height * layout.scaledHeight) * 1.75
  const cropX = centerX - side / 2
  const cropY = centerY - side / 2
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

function assessFaceSkin(labels: Buffer): FaceSkinAssessment {
  let skinSamples = 0
  let featureSamples = 0
  let totalSamples = 0
  for (let y = 0; y < FACE_PARSE_SIZE; y += 8) {
    for (let x = 0; x < FACE_PARSE_SIZE; x += 8) {
      const label = labels[y * FACE_PARSE_SIZE + x]
      if (FACE_SKIN_LABELS.has(label)) skinSamples += 1
      if (FACE_EYE_LABELS.has(label) || FACE_MOUTH_LABELS.has(label)) featureSamples += 1
      totalSamples += 1
    }
  }
  const skinRatio = skinSamples / totalSamples
  if (skinRatio < 0.035 || featureSamples < 3) {
    return { mask: null, skinRatio, featureSamples }
  }

  const output = new Uint8Array(labels.length)
  for (let index = 0; index < labels.length; index += 1) {
    if (FACE_SKIN_LABELS.has(labels[index])) output[index] = 1
  }
  return { mask: output, skinRatio, featureSamples }
}

function compositeFaceLabels(
  skinSamples: Uint32Array,
  protectedSamples: Uint32Array,
  totalSamples: Uint32Array,
  labels: Buffer,
  usableSkin: Uint8Array,
  crop: ReturnType<typeof cropFace>,
  layout: SourceLayout,
): void {
  for (let y = 0; y < FACE_PARSE_SIZE; y += 1) {
    for (let x = 0; x < FACE_PARSE_SIZE; x += 1) {
      const inputX = crop.x + (x + 0.5) / FACE_PARSE_SIZE * crop.side
      const inputY = crop.y + (y + 0.5) / FACE_PARSE_SIZE * crop.side
      const targetX = Math.floor((inputX - layout.padX) / layout.scaledWidth * MASK_SIZE)
      const targetY = Math.floor((inputY - layout.padY) / layout.scaledHeight * MASK_SIZE)
      if (targetX >= 0 && targetX < MASK_SIZE && targetY >= 0 && targetY < MASK_SIZE) {
        const targetIndex = targetY * MASK_SIZE + targetX
        const label = labels[y * FACE_PARSE_SIZE + x]
        totalSamples[targetIndex] += 1
        if (usableSkin[y * FACE_PARSE_SIZE + x]) skinSamples[targetIndex] += 1
        else if (label !== 0) protectedSamples[targetIndex] += 1
      }
    }
  }
}

function faceSkinMask(
  skinSamples: Uint32Array,
  protectedSamples: Uint32Array,
  totalSamples: Uint32Array,
): Uint8Array {
  const output = new Uint8Array(MASK_SIZE * MASK_SIZE)
  let hasSkin = false
  for (let index = 0; index < output.length; index += 1) {
    const total = totalSamples[index]
    if (total === 0 || skinSamples[index] === 0) continue
    // Any protected sample wins over skin so thin brows, eye contours and lips
    // survive projection into the whole-image mask.
    if (protectedSamples[index] > 0) continue
    output[index] = Math.round(skinSamples[index] / total * 255)
    hasSkin = true
  }
  return hasSkin ? softenMask(output) : output
}

function compositeFaceMask(
  output: Uint8Array,
  localMask: Uint8Array,
  crop: ReturnType<typeof cropFace>,
  layout: SourceLayout,
): void {
  const left = Math.max(0, Math.floor((crop.x - layout.padX) / layout.scaledWidth * MASK_SIZE))
  const top = Math.max(0, Math.floor((crop.y - layout.padY) / layout.scaledHeight * MASK_SIZE))
  const right = Math.min(MASK_SIZE - 1, Math.ceil((crop.x + crop.side - layout.padX) / layout.scaledWidth * MASK_SIZE))
  const bottom = Math.min(MASK_SIZE - 1, Math.ceil((crop.y + crop.side - layout.padY) / layout.scaledHeight * MASK_SIZE))
  for (let y = top; y <= bottom; y += 1) {
    const inputY = layout.padY + (y + 0.5) / MASK_SIZE * layout.scaledHeight
    const localY = Math.floor((inputY - crop.y) / crop.side * FACE_PARSE_SIZE)
    if (localY < 0 || localY >= FACE_PARSE_SIZE) continue
    for (let x = left; x <= right; x += 1) {
      const inputX = layout.padX + (x + 0.5) / MASK_SIZE * layout.scaledWidth
      const localX = Math.floor((inputX - crop.x) / crop.side * FACE_PARSE_SIZE)
      if (localX < 0 || localX >= FACE_PARSE_SIZE) continue
      const value = localMask[localY * FACE_PARSE_SIZE + localX]
      const index = y * MASK_SIZE + x
      if (value > output[index]) output[index] = value
    }
  }
}

function closeMask(input: Uint8Array): Uint8Array {
  const dilated = new Uint8Array(input.length)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let active = false
      for (let offsetY = -1; offsetY <= 1 && !active; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(MASK_SIZE - 1, y + offsetY))
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(MASK_SIZE - 1, x + offsetX))
          if (input[sampleY * MASK_SIZE + sampleX] >= 128) {
            active = true
            break
          }
        }
      }
      if (active) dilated[y * MASK_SIZE + x] = 255
    }
  }

  const output = new Uint8Array(input.length)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let active = true
      for (let offsetY = -1; offsetY <= 1 && active; offsetY += 1) {
        const sampleY = Math.max(0, Math.min(MASK_SIZE - 1, y + offsetY))
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(MASK_SIZE - 1, x + offsetX))
          if (dilated[sampleY * MASK_SIZE + sampleX] === 0) {
            active = false
            break
          }
        }
      }
      if (active) output[y * MASK_SIZE + x] = 255
    }
  }
  return output
}

function softenMask(input: Uint8Array): Uint8Array {
  const radius = 3
  const closed = closeMask(input)
  const horizontal = new Float32Array(closed.length)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let sum = 0
      let weightSum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(MASK_SIZE - 1, x + offset))
        const weight = radius + 1 - Math.abs(offset)
        sum += closed[y * MASK_SIZE + sampleX] * weight
        weightSum += weight
      }
      horizontal[y * MASK_SIZE + x] = sum / weightSum
    }
  }
  const output = new Uint8Array(input.length)
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      let sum = 0
      let weightSum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(MASK_SIZE - 1, y + offset))
        const weight = radius + 1 - Math.abs(offset)
        sum += horizontal[sampleY * MASK_SIZE + x] * weight
        weightSum += weight
      }
      output[y * MASK_SIZE + x] = Math.round(sum / weightSum)
    }
  }
  return output
}

function resizeContent(rgb: Buffer, layout: SourceLayout, outputSize: number): Buffer {
  const output = Buffer.alloc(outputSize * outputSize * 3)
  for (let y = 0; y < outputSize; y += 1) {
    const sourceY = Math.max(0, Math.min(INPUT_SIZE - 1,
      Math.floor(layout.padY + (y + 0.5) * layout.scaledHeight / outputSize)))
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = Math.max(0, Math.min(INPUT_SIZE - 1,
        Math.floor(layout.padX + (x + 0.5) * layout.scaledWidth / outputSize)))
      const sourceOffset = (sourceY * INPUT_SIZE + sourceX) * 3
      const targetOffset = (y * outputSize + x) * 3
      output[targetOffset] = rgb[sourceOffset]
      output[targetOffset + 1] = rgb[sourceOffset + 1]
      output[targetOffset + 2] = rgb[sourceOffset + 2]
    }
  }
  return output
}

function bodySkinMask(labels: Buffer): Uint8Array {
  const output = new Uint8Array(MASK_SIZE * MASK_SIZE)
  let hasSkin = false
  for (let y = 0; y < MASK_SIZE; y += 1) {
    const sourceY = Math.min(HUMAN_PARSE_SIZE - 1, Math.floor((y + 0.5) * HUMAN_PARSE_SIZE / MASK_SIZE))
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const sourceX = Math.min(HUMAN_PARSE_SIZE - 1, Math.floor((x + 0.5) * HUMAN_PARSE_SIZE / MASK_SIZE))
      if (BODY_SKIN_LABELS.has(labels[sourceY * HUMAN_PARSE_SIZE + sourceX])) {
        output[y * MASK_SIZE + x] = 255
        hasSkin = true
      }
    }
  }
  return hasSkin ? softenMask(output) : output
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

  report?.('recognizing', '正在识别人脸、皮肤和面部瑕疵', null)
  const inferenceStarted = performance.now()
  const humanRgb = resizeContent(rgb, layout, HUMAN_PARSE_SIZE)
  const [faces, humanResult] = await Promise.all([
    extractFaceBoxesInWorker(faceDetector.path, rgb, layout, signal),
    segmentSpecializedInWorker({
      backend: 'human-parsing', modelPath: humanParser.path, rgb: humanRgb,
      scaledWidth: HUMAN_PARSE_SIZE, scaledHeight: HUMAN_PARSE_SIZE,
      padX: 0, padY: 0, outputSize: HUMAN_PARSE_SIZE,
    }, signal),
  ])
  const skinSamples = new Uint32Array(MASK_SIZE * MASK_SIZE)
  const protectedSamples = new Uint32Array(MASK_SIZE * MASK_SIZE)
  const totalSamples = new Uint32Array(MASK_SIZE * MASK_SIZE)
  const acneMask = new Uint8Array(MASK_SIZE * MASK_SIZE)
  const spotMask = new Uint8Array(MASK_SIZE * MASK_SIZE)
  const wrinkleMask = new Uint8Array(MASK_SIZE * MASK_SIZE)
  const processedFaces = faces.slice(0, 8)
  let acceptedFaceCount = 0
  let acneCount = 0
  let spotCount = 0
  let wrinkleCount = 0
  for (const face of processedFaces) {
    signal.throwIfAborted()
    const crop = cropFace(rgb, face, layout)
    const parsed = await segmentSpecializedInWorker({
      backend: 'face-parsing', modelPath: faceParser.path, rgb: crop.rgb,
      scaledWidth: FACE_PARSE_SIZE, scaledHeight: FACE_PARSE_SIZE, padX: 0, padY: 0, outputSize: FACE_PARSE_SIZE,
    }, signal)
    const assessment = assessFaceSkin(parsed.bytes)
    logMainInfo('[Beauty] 面部皮肤解析', {
      skinRatio: Number(assessment.skinRatio.toFixed(4)),
      featureSamples: assessment.featureSamples,
      accepted: assessment.mask !== null,
    })
    if (!assessment.mask) continue
    acceptedFaceCount += 1
    const blemishes = detectFaceBlemishes(crop.rgb, parsed.bytes, FACE_PARSE_SIZE)
    compositeFaceMask(acneMask, blemishes.acneMask, crop, layout)
    compositeFaceMask(spotMask, blemishes.spotMask, crop, layout)
    compositeFaceMask(wrinkleMask, blemishes.wrinkleMask, crop, layout)
    acneCount += blemishes.acneCount
    spotCount += blemishes.spotCount
    wrinkleCount += blemishes.wrinkleCount
    compositeFaceLabels(
      skinSamples,
      protectedSamples,
      totalSamples,
      parsed.bytes,
      assessment.mask,
      crop,
      layout,
    )
  }
  const softFaceMask = faceSkinMask(skinSamples, protectedSamples, totalSamples)
  logMainInfo('[Beauty] 面部选区完成', {
    candidates: processedFaces.length,
    accepted: acceptedFaceCount,
    activePixels: softFaceMask.reduce((count, value) => count + Number(value >= 128), 0),
    acneCount,
    spotCount,
    wrinkleCount,
  })
  const skinMask = bodySkinMask(humanResult.bytes)
  const inferenceMs = performance.now() - inferenceStarted
  return {
    requestId,
    width: MASK_SIZE,
    height: MASK_SIZE,
    faceCount: acceptedFaceCount,
    acneCount,
    spotCount,
    wrinkleCount,
    faceMask: toArrayBuffer(softFaceMask),
    skinMask: toArrayBuffer(skinMask),
    acneMask: toArrayBuffer(acneMask),
    spotMask: toArrayBuffer(spotMask),
    wrinkleMask: toArrayBuffer(wrinkleMask),
    performance: {
      modelLoadMs: Math.round(modelLoadMs),
      imagePrepareMs: Math.round(imagePrepareMs),
      inferenceMs: Math.round(inferenceMs),
      totalMs: Math.round(performance.now() - started),
    },
  }
}
