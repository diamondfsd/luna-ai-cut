/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV.js omits several runtime tracking APIs from its declarations. */
import cvModule from '@techstark/opencv-js'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { parentPort } from 'node:worker_threads'

interface TrackingWorkerInput {
  requestId: string
  ffmpegPath: string
  filePath: string
  direction: 'forward' | 'backward'
  anchorTime: number
  endTime?: number
  duration: number
  sourceWidth: number
  sourceHeight: number
  maskWidth: number
  maskHeight: number
  maskBytes: Uint8Array
  initialTransform?: {
    translateX: number
    translateY: number
    scale: number
    rotation: number
  }
}

interface SimilarityTransform {
  a: number
  b: number
  tx: number
  ty: number
}

interface TrackKeyframe {
  time: number
  translateX: number
  translateY: number
  scale: number
  rotation: number
  confidence: number
}

const output = parentPort
if (!output) throw new Error('蒙版追踪线程缺少消息端口')
let input: TrackingWorkerInput
let canceled = false
let activeDecoder: ChildProcessWithoutNullStreams | null = null

const SAMPLE_RATE = 8
const CHUNK_SECONDS = 5
const MIN_POINTS = 8
const MAX_POINTS = 240
const IDENTITY: SimilarityTransform = { a: 1, b: 0, tx: 0, ty: 0 }

function post(message: Record<string, unknown>): void {
  output!.postMessage({ requestId: input.requestId, ...message })
}

function processingSize(): { width: number; height: number } {
  const maxSide = 480
  const scale = Math.min(1, maxSide / Math.max(input.sourceWidth, input.sourceHeight))
  return {
    width: Math.max(16, Math.round(input.sourceWidth * scale)),
    height: Math.max(16, Math.round(input.sourceHeight * scale)),
  }
}

function resizedMask(width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(input.maskHeight - 1, Math.floor(y / height * input.maskHeight))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(input.maskWidth - 1, Math.floor(x / width * input.maskWidth))
      result[y * width + x] = input.maskBytes[sourceY * input.maskWidth + sourceX]
    }
  }
  return result
}

async function decodeFrames(
  start: number,
  duration: number,
  width: number,
  height: number,
  hardwareAcceleration = true,
): Promise<Buffer[]> {
  if (canceled) throw new Error('蒙版追踪已取消')
  if (duration <= 0.0001) return []
  const frameBytes = width * height
  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...(hardwareAcceleration ? ['-hwaccel', 'auto'] : []),
    '-ss', start.toFixed(6), '-i', input.filePath,
    '-t', duration.toFixed(6), '-an', '-sn',
    '-vf', `fps=${SAMPLE_RATE},scale=${width}:${height}:flags=bicubic,format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ]
  return new Promise<Buffer[]>((resolve, reject) => {
    const child = spawn(input.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    activeDecoder = child
    const chunks: Buffer[] = []
    const errors: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (activeDecoder === child) activeDecoder = null
      if (canceled) {
        reject(new Error('蒙版追踪已取消'))
        return
      }
      if (code !== 0) {
        if (hardwareAcceleration) {
          void decodeFrames(start, duration, width, height, false).then(resolve, reject)
          return
        }
        reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `视频解码进程异常退出 (${signal ?? code})`))
        return
      }
      const bytes = Buffer.concat(chunks)
      const frames: Buffer[] = []
      for (let offset = 0; offset + frameBytes <= bytes.length; offset += frameBytes) {
        frames.push(bytes.subarray(offset, offset + frameBytes))
      }
      resolve(frames)
    })
  })
}

function multiply(left: SimilarityTransform, right: SimilarityTransform): SimilarityTransform {
  return {
    a: left.a * right.a - left.b * right.b,
    b: left.b * right.a + left.a * right.b,
    tx: left.a * right.tx - left.b * right.ty + left.tx,
    ty: left.b * right.tx + left.a * right.ty + left.ty,
  }
}

function keyframe(transform: SimilarityTransform, time: number, confidence: number, width: number, height: number): TrackKeyframe {
  const centerX = width / 2
  const centerY = height / 2
  const transformedCenterX = transform.a * centerX - transform.b * centerY + transform.tx
  const transformedCenterY = transform.b * centerX + transform.a * centerY + transform.ty
  return {
    time,
    translateX: (transformedCenterX - centerX) / width,
    translateY: (transformedCenterY - centerY) / height,
    scale: Math.hypot(transform.a, transform.b),
    rotation: Math.atan2(transform.b, transform.a),
    confidence,
  }
}

function initialTransform(width: number, height: number): SimilarityTransform {
  const initial = input.initialTransform
  if (!initial) return IDENTITY
  const a = Math.cos(initial.rotation) * initial.scale
  const b = Math.sin(initial.rotation) * initial.scale
  const centerX = width / 2
  const centerY = height / 2
  return {
    a,
    b,
    tx: centerX + initial.translateX * width - (a * centerX - b * centerY),
    ty: centerY + initial.translateY * height - (b * centerX + a * centerY),
  }
}

function median(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function fitSimilarityTransform(
  from: number[],
  to: number[],
  inlierIndexes: number[],
): { transform: SimilarityTransform; residuals: number[] } | null {
  if (inlierIndexes.length < 2) return null
  let fromCenterX = 0
  let fromCenterY = 0
  let toCenterX = 0
  let toCenterY = 0
  for (const index of inlierIndexes) {
    fromCenterX += from[index * 2]
    fromCenterY += from[index * 2 + 1]
    toCenterX += to[index * 2]
    toCenterY += to[index * 2 + 1]
  }
  fromCenterX /= inlierIndexes.length
  fromCenterY /= inlierIndexes.length
  toCenterX /= inlierIndexes.length
  toCenterY /= inlierIndexes.length

  let denominator = 0
  let realNumerator = 0
  let imaginaryNumerator = 0
  for (const index of inlierIndexes) {
    const fromX = from[index * 2] - fromCenterX
    const fromY = from[index * 2 + 1] - fromCenterY
    const toX = to[index * 2] - toCenterX
    const toY = to[index * 2 + 1] - toCenterY
    denominator += fromX * fromX + fromY * fromY
    realNumerator += fromX * toX + fromY * toY
    imaginaryNumerator += fromX * toY - fromY * toX
  }
  if (!Number.isFinite(denominator) || denominator < 0.0001) return null
  const a = realNumerator / denominator
  const b = imaginaryNumerator / denominator
  const tx = toCenterX - (a * fromCenterX - b * fromCenterY)
  const ty = toCenterY - (b * fromCenterX + a * fromCenterY)
  const transform = { a, b, tx, ty }
  const residuals = inlierIndexes.map((index) => {
    const sourceX = from[index * 2]
    const sourceY = from[index * 2 + 1]
    const predictedX = a * sourceX - b * sourceY + tx
    const predictedY = b * sourceX + a * sourceY + ty
    return Math.hypot(predictedX - to[index * 2], predictedY - to[index * 2 + 1])
  })
  return { transform, residuals }
}

async function run(): Promise<void> {
  const cv = await Promise.resolve(cvModule as unknown as PromiseLike<any>)
  const { width, height } = processingSize()
  const anchorMask = new cv.Mat(height, width, cv.CV_8UC1)
  anchorMask.data.set(resizedMask(width, height))
  const anchorFrames = await decodeFrames(input.anchorTime, 1 / SAMPLE_RATE, width, height)
  if (anchorFrames.length === 0) throw new Error('无法读取当前视频帧')

  let currentFrame = new cv.Mat(height, width, cv.CV_8UC1)
  currentFrame.data.set(anchorFrames[0])
  let accumulated = initialTransform(width, height)
  let currentMask = transformedMask(cv, anchorMask, accumulated, width, height)
  let points = detectPoints(cv, currentFrame, currentMask)
  if (points.length < MIN_POINTS) throw new Error('蒙版区域纹理不足，无法稳定追踪')

  let currentTime = input.anchorTime
  let stoppedReason: string | undefined
  const keyframes: TrackKeyframe[] = [keyframe(accumulated, input.anchorTime, 1, width, height)]
  const forwardEnd = Math.min(input.duration, input.endTime ?? input.duration)
  const targetSpan = input.direction === 'forward' ? forwardEnd - input.anchorTime : input.anchorTime
  let processedFrames = 0

  try {
    while (input.direction === 'forward' ? currentTime < forwardEnd - 0.0001 : currentTime > 0.0001) {
      const chunkStart = input.direction === 'forward'
        ? currentTime + 1 / SAMPLE_RATE
        : Math.max(0, currentTime - CHUNK_SECONDS)
      const chunkEnd = input.direction === 'forward'
        ? Math.min(forwardEnd, chunkStart + CHUNK_SECONDS)
        : currentTime
      const decoded = await decodeFrames(chunkStart, Math.max(1 / SAMPLE_RATE, chunkEnd - chunkStart), width, height)
      const scheduled = decoded.map((bytes, index) => ({
        bytes,
        time: Math.min(input.duration, chunkStart + index / SAMPLE_RATE),
      }))
      if (input.direction === 'backward') scheduled.reverse()
      if (scheduled.length === 0) break

      for (const item of scheduled) {
        if (input.direction === 'backward' && item.time >= currentTime - 0.0001) continue
        if (input.direction === 'forward' && item.time <= currentTime + 0.0001) continue
        if (input.direction === 'forward' && item.time > forwardEnd + 0.0001) continue
        const nextFrame = new cv.Mat(height, width, cv.CV_8UC1)
        nextFrame.data.set(item.bytes)
        const step = estimateStep(cv, currentFrame, nextFrame, points, width, height)
        if (!step.ok) {
          stoppedReason = step.reason
          nextFrame.delete()
          break
        }
        accumulated = multiply(step.transform, accumulated)
        const scale = Math.hypot(accumulated.a, accumulated.b)
        if (scale < 0.35 || scale > 3 || Math.abs(step.transform.tx) > width * 0.3 || Math.abs(step.transform.ty) > height * 0.3) {
          stoppedReason = '画面变化过大，已在失去目标前停止'
          nextFrame.delete()
          break
        }
        currentFrame.delete()
        currentFrame = nextFrame
        currentTime = item.time
        points = step.points
        processedFrames += 1
        if (processedFrames % 8 === 0 || points.length < 40) {
          currentMask.delete()
          currentMask = transformedMask(cv, anchorMask, accumulated, width, height)
          const refreshed = detectPoints(cv, currentFrame, currentMask)
          if (refreshed.length >= MIN_POINTS) points = refreshed
        }
        keyframes.push(keyframe(accumulated, currentTime, step.confidence, width, height))
        const completed = targetSpan <= 0 ? 1 : Math.abs(currentTime - input.anchorTime) / targetSpan
        post({ kind: 'progress', percent: Math.min(100, Math.round(completed * 100)), time: currentTime, confidence: step.confidence })
      }
      if (stoppedReason) break
    }
  } finally {
    currentFrame.delete()
    currentMask.delete()
    anchorMask.delete()
  }

  keyframes.sort((left, right) => left.time - right.time)
  post({
    kind: 'result',
    keyframes,
    stoppedReason,
    completed: !stoppedReason,
    width,
    height,
  })
}

function detectPoints(cv: any, frame: any, mask: any): Array<{ x: number; y: number }> {
  const keypoints = new cv.KeyPointVector()
  const detector = new cv.GFTTDetector(MAX_POINTS, 0.01, 5, 3, false, 0.04)
  try {
    detector.detect(frame, keypoints, mask)
    const result: Array<{ x: number; y: number }> = []
    for (let index = 0; index < keypoints.size(); index += 1) result.push(keypoints.get(index).pt)
    return result
  } finally {
    detector.delete()
    keypoints.delete()
  }
}

function transformedMask(cv: any, source: any, transform: SimilarityTransform, width: number, height: number): any {
  const destination = new cv.Mat(height, width, cv.CV_8UC1)
  const matrix = cv.matFromArray(2, 3, cv.CV_64F, [transform.a, -transform.b, transform.tx, transform.b, transform.a, transform.ty])
  try {
    cv.warpAffine(source, destination, matrix, new cv.Size(width, height), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0))
    return destination
  } finally {
    matrix.delete()
  }
}

function estimateStep(
  cv: any,
  previousFrame: any,
  nextFrame: any,
  inputPoints: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): { ok: true; transform: SimilarityTransform; confidence: number; points: Array<{ x: number; y: number }> } | { ok: false; reason: string } {
  if (inputPoints.length < MIN_POINTS) return { ok: false, reason: '可追踪特征不足，已停止以避免蒙版漂移' }
  const flat = inputPoints.flatMap((point) => [point.x, point.y])
  const previousPoints = cv.matFromArray(inputPoints.length, 1, cv.CV_32FC2, flat)
  const forwardPoints = new cv.Mat()
  const forwardStatus = new cv.Mat()
  const forwardError = new cv.Mat()
  const backwardPoints = new cv.Mat()
  const backwardStatus = new cv.Mat()
  const backwardError = new cv.Mat()
  try {
    const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, 0.01)
    cv.calcOpticalFlowPyrLK(previousFrame, nextFrame, previousPoints, forwardPoints, forwardStatus, forwardError, new cv.Size(21, 21), 3, criteria)
    cv.calcOpticalFlowPyrLK(nextFrame, previousFrame, forwardPoints, backwardPoints, backwardStatus, backwardError, new cv.Size(21, 21), 3, criteria)
    const from: number[] = []
    const to: number[] = []
    const fbErrors: number[] = []
    for (let index = 0; index < inputPoints.length; index += 1) {
      if (!forwardStatus.data[index] || !backwardStatus.data[index]) continue
      const nextX = forwardPoints.data32F[index * 2]
      const nextY = forwardPoints.data32F[index * 2 + 1]
      const backX = backwardPoints.data32F[index * 2]
      const backY = backwardPoints.data32F[index * 2 + 1]
      const fbError = Math.hypot(backX - inputPoints[index].x, backY - inputPoints[index].y)
      if (!Number.isFinite(nextX) || !Number.isFinite(nextY) || nextX < 0 || nextY < 0 || nextX >= width || nextY >= height || fbError > 2.5) continue
      from.push(inputPoints[index].x, inputPoints[index].y)
      to.push(nextX, nextY)
      fbErrors.push(fbError)
    }
    const count = from.length / 2
    if (count < MIN_POINTS) return { ok: false, reason: '目标特征丢失，已停止以避免蒙版漂移' }
    const fromMat = cv.matFromArray(count, 1, cv.CV_32FC2, from)
    const toMat = cv.matFromArray(count, 1, cv.CV_32FC2, to)
    const inliers = new cv.Mat()
    let affine: any
    try {
      affine = cv.estimateAffine2D(fromMat, toMat, inliers, cv.RANSAC, 2.5, 1500, 0.98, 10)
      if (!affine || affine.empty()) return { ok: false, reason: '无法估计目标运动，已停止追踪' }
      let inlierCount = 0
      const inlierIndexes: number[] = []
      const nextPoints: Array<{ x: number; y: number }> = []
      for (let index = 0; index < count; index += 1) {
        if (!inliers.data[index]) continue
        inlierCount += 1
        inlierIndexes.push(index)
        nextPoints.push({ x: to[index * 2], y: to[index * 2 + 1] })
      }
      const inlierRatio = inlierCount / count
      const retainedRatio = count / inputPoints.length
      const fbQuality = Math.exp(-median(fbErrors) / 1.5)
      const similarity = fitSimilarityTransform(from, to, inlierIndexes)
      if (!similarity) return { ok: false, reason: '无法估计目标运动，已停止追踪' }
      const modelError = median(similarity.residuals)
      const modelQuality = Math.exp(-modelError / 1.5)
      const confidence = Math.max(0, Math.min(1, inlierRatio * 0.4 + retainedRatio * 0.2 + fbQuality * 0.2 + modelQuality * 0.2))
      if (inlierCount < MIN_POINTS || inlierRatio < 0.42 || confidence < 0.48) {
        return { ok: false, reason: '追踪置信度过低，已停止以避免蒙版漂移' }
      }
      return {
        ok: true,
        transform: similarity.transform,
        confidence,
        points: nextPoints,
      }
    } finally {
      affine?.delete()
      inliers.delete()
      fromMat.delete()
      toMat.delete()
    }
  } finally {
    previousPoints.delete()
    forwardPoints.delete()
    forwardStatus.delete()
    forwardError.delete()
    backwardPoints.delete()
    backwardStatus.delete()
    backwardError.delete()
  }
}

output.on('message', (message: TrackingWorkerInput | { kind: 'cancel' }) => {
  if ('kind' in message) {
    if (message.kind === 'cancel') {
      canceled = true
      activeDecoder?.kill()
    }
    return
  }
  if (input) return
  input = message
  run().catch((error: unknown) => {
    if (!canceled) post({ kind: 'error', error: error instanceof Error ? error.message : String(error) })
  })
})
