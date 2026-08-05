import { execFile } from 'node:child_process'

import type { WorkspaceBeautyAnalysisResult } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadModel, MODEL_REGISTRY, type ModelId, type ModelLoadProgress } from './modelLoader'
import { logMainInfo } from './loggerService'
import { extractFaceBoxesInWorker, segmentSpecializedInSecondaryWorker, segmentSpecializedInWorker } from './specializedSegmentationService'
import { detectFaceBlemishes } from './beautyBlemishDetection'
import { bodySkinMaskFromHumanLabels, faceSkinMaskFromSamples, personMaskFromHumanLabels, softenBeautyMask } from './beautySkinSegmentation'

const INPUT_SIZE = 640
const MASK_SIZE = 1024
const VIDEO_MASK_SIZE = 512
const FACE_PARSE_SIZE = 512
const HUMAN_PARSE_SIZE = 512
const FACE_SKIN_FEATHER_RADIUS = 10
const BODY_SKIN_FEATHER_RADIUS = 12
const FACE_SKIN_LABELS = new Set([1, 7, 8, 10, 14])
const FACE_EYE_LABELS = new Set([4, 5])
const FACE_MOUTH_LABELS = new Set([11, 12, 13])
const BEAUTY_MODEL_IDS = ['ultraface-rfb-320', 'schp-atr-resnet101-512', 'face-parsing-resnet18'] as const satisfies readonly ModelId[]

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

function decodeImage(filePath: string, signal: AbortSignal, frameTime?: number): Promise<{ rgb: Buffer; layout: SourceLayout }> {
  return new Promise((resolve, reject) => {
    const decodeAt = (requestedTime: number | undefined, allowEndFallback: boolean, hardwareAcceleration = true): void => {
      const args = [
        '-v', 'error',
        ...(hardwareAcceleration ? ['-hwaccel', 'auto'] : []),
        ...(requestedTime == null ? [] : ['-ss', requestedTime.toFixed(3)]),
        '-i', filePath, '-frames:v', '1',
        '-vf', `scale=${INPUT_SIZE}:${INPUT_SIZE}:force_original_aspect_ratio=decrease:flags=bilinear,pad=${INPUT_SIZE}:${INPUT_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x727272`,
        '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
      ]
      execFile(getFfmpegPath(), args, {
        encoding: 'buffer',
        maxBuffer: INPUT_SIZE * INPUT_SIZE * 3 + 1024,
        signal,
      }, (error, stdout) => {
        if (error) {
          if (hardwareAcceleration && !signal.aborted) {
            decodeAt(requestedTime, allowEndFallback, false)
            return
          }
          return reject(error)
        }
        const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
        if (rgb.byteLength !== INPUT_SIZE * INPUT_SIZE * 3) {
          if (allowEndFallback && requestedTime != null && requestedTime > 0 && !signal.aborted) {
            decodeAt(Math.max(0, requestedTime - 0.25), false, hardwareAcceleration)
            return
          }
          reject(new Error('美颜分析画面读取不完整'))
          return
        }

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
    }
    decodeAt(frameTime, frameTime != null)
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
  outputSize: number,
): void {
  for (let y = 0; y < FACE_PARSE_SIZE; y += 1) {
    for (let x = 0; x < FACE_PARSE_SIZE; x += 1) {
      const inputX = crop.x + (x + 0.5) / FACE_PARSE_SIZE * crop.side
      const inputY = crop.y + (y + 0.5) / FACE_PARSE_SIZE * crop.side
      const targetX = Math.floor((inputX - layout.padX) / layout.scaledWidth * outputSize)
      const targetY = Math.floor((inputY - layout.padY) / layout.scaledHeight * outputSize)
      if (targetX >= 0 && targetX < outputSize && targetY >= 0 && targetY < outputSize) {
        const targetIndex = targetY * outputSize + targetX
        const label = labels[y * FACE_PARSE_SIZE + x]
        totalSamples[targetIndex] += 1
        if (usableSkin[y * FACE_PARSE_SIZE + x]) skinSamples[targetIndex] += 1
        else if (label !== 0) protectedSamples[targetIndex] += 1
      }
    }
  }
}

function compositeFaceMask(
  output: Uint8Array,
  localMask: Uint8Array,
  crop: ReturnType<typeof cropFace>,
  layout: SourceLayout,
  outputSize: number,
): void {
  const left = Math.max(0, Math.floor((crop.x - layout.padX) / layout.scaledWidth * outputSize))
  const top = Math.max(0, Math.floor((crop.y - layout.padY) / layout.scaledHeight * outputSize))
  const right = Math.min(outputSize - 1, Math.ceil((crop.x + crop.side - layout.padX) / layout.scaledWidth * outputSize))
  const bottom = Math.min(outputSize - 1, Math.ceil((crop.y + crop.side - layout.padY) / layout.scaledHeight * outputSize))
  for (let y = top; y <= bottom; y += 1) {
    const inputY = layout.padY + (y + 0.5) / outputSize * layout.scaledHeight
    const localY = Math.floor((inputY - crop.y) / crop.side * FACE_PARSE_SIZE)
    if (localY < 0 || localY >= FACE_PARSE_SIZE) continue
    for (let x = left; x <= right; x += 1) {
      const inputX = layout.padX + (x + 0.5) / outputSize * layout.scaledWidth
      const localX = Math.floor((inputX - crop.x) / crop.side * FACE_PARSE_SIZE)
      if (localX < 0 || localX >= FACE_PARSE_SIZE) continue
      const value = localMask[localY * FACE_PARSE_SIZE + localX]
      const index = y * outputSize + x
      if (value > output[index]) output[index] = value
    }
  }
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function analyzeBeauty(
  requestId: string,
  filePath: string,
  signal: AbortSignal,
  report?: (phase: 'model' | 'preparing' | 'recognizing', label: string, percent: number | null) => void,
  frameTime?: number,
  videoFrame = false,
): Promise<WorkspaceBeautyAnalysisResult> {
  const started = performance.now()
  report?.('model', '正在准备美颜模型', null)
  const modelStarted = performance.now()
  const completedByModel = new Map<ModelId, number>()
  const totalModelBytes = BEAUTY_MODEL_IDS.reduce((total, id) => total + MODEL_REGISTRY[id].sizeBytes, 0)
  let lastModelPercent = -1
  const reportModelProgress = (id: ModelId) => (progress: ModelLoadProgress): void => {
    completedByModel.set(id, Math.max(0, Math.min(MODEL_REGISTRY[id].sizeBytes, progress.completedBytes)))
    const completedBytes = [...completedByModel.values()].reduce((total, bytes) => total + bytes, 0)
    const percent = Math.round(completedBytes / totalModelBytes * 100)
    if (percent === lastModelPercent) return
    lastModelPercent = percent
    report?.('model', '正在准备美颜模型', percent)
  }
  const [faceDetector, humanParser, faceParser] = await Promise.all(BEAUTY_MODEL_IDS.map((id) => (
    loadModel(id, reportModelProgress(id), signal)
  )))
  const modelLoadMs = performance.now() - modelStarted
  signal.throwIfAborted()

  report?.('preparing', '正在读取图片', null)
  const prepareStarted = performance.now()
  const { rgb, layout } = await decodeImage(filePath, signal, frameTime)
  const imagePrepareMs = performance.now() - prepareStarted

  report?.('recognizing', videoFrame ? '正在识别人脸和皮肤' : '正在识别人脸、皮肤和面部瑕疵', null)
  const inferenceStarted = performance.now()
  const outputSize = videoFrame ? VIDEO_MASK_SIZE : MASK_SIZE
  const humanRgb = resizeContent(rgb, layout, HUMAN_PARSE_SIZE)
  const [faces, humanResult] = await Promise.all([
    extractFaceBoxesInWorker(faceDetector.path, rgb, layout, signal),
    segmentSpecializedInSecondaryWorker({
      backend: 'human-parsing', modelPath: humanParser.path, rgb: humanRgb,
      scaledWidth: HUMAN_PARSE_SIZE, scaledHeight: HUMAN_PARSE_SIZE,
      padX: 0, padY: 0, outputSize: HUMAN_PARSE_SIZE,
    }, signal),
  ])
  const skinSamples = new Uint32Array(outputSize * outputSize)
  const protectedSamples = new Uint32Array(outputSize * outputSize)
  const totalSamples = new Uint32Array(outputSize * outputSize)
  const acneMask = new Uint8Array(outputSize * outputSize)
  const spotMask = new Uint8Array(outputSize * outputSize)
  const wrinkleMask = new Uint8Array(outputSize * outputSize)
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
    if (!videoFrame) {
      const blemishes = detectFaceBlemishes(crop.rgb, parsed.bytes, FACE_PARSE_SIZE)
      compositeFaceMask(acneMask, blemishes.acneMask, crop, layout, outputSize)
      compositeFaceMask(spotMask, blemishes.spotMask, crop, layout, outputSize)
      compositeFaceMask(wrinkleMask, blemishes.wrinkleMask, crop, layout, outputSize)
      acneCount += blemishes.acneCount
      spotCount += blemishes.spotCount
      wrinkleCount += blemishes.wrinkleCount
    }
    compositeFaceLabels(
      skinSamples,
      protectedSamples,
      totalSamples,
      parsed.bytes,
      assessment.mask,
      crop,
      layout,
      outputSize,
    )
  }
  const softFaceMask = faceSkinMaskFromSamples(
    skinSamples,
    protectedSamples,
    totalSamples,
    outputSize,
    FACE_SKIN_FEATHER_RADIUS,
  )
  logMainInfo('[Beauty] 面部选区完成', {
    candidates: processedFaces.length,
    accepted: acceptedFaceCount,
    activePixels: softFaceMask.reduce((count, value) => count + Number(value >= 128), 0),
    acneCount,
    spotCount,
    wrinkleCount,
  })
  const skinMask = softenBeautyMask(
    bodySkinMaskFromHumanLabels(humanResult.bytes, HUMAN_PARSE_SIZE, outputSize),
    outputSize,
    BODY_SKIN_FEATHER_RADIUS,
  )
  const trackingGuideMask = personMaskFromHumanLabels(humanResult.bytes, HUMAN_PARSE_SIZE, outputSize)
  const inferenceMs = performance.now() - inferenceStarted
  return {
    requestId,
    width: outputSize,
    height: outputSize,
    faceCount: acceptedFaceCount,
    acneCount,
    spotCount,
    wrinkleCount,
    faceMask: toArrayBuffer(softFaceMask),
    skinMask: toArrayBuffer(skinMask),
    trackingGuideMask: toArrayBuffer(trackingGuideMask),
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
