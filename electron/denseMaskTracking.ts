/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV.js optical-flow APIs are absent from its declarations. */

export interface DenseTrackingStep {
  ok: true
  mask: Uint8Array
  guide: Uint8Array
  confidence: number
}

export interface DenseTrackingFailure {
  ok: false
  reason: string
}

function sampleScalar(values: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = values[y0 * width + x0] * (1 - fx) + values[y0 * width + x1] * fx
  const bottom = values[y1 * width + x0] * (1 - fx) + values[y1 * width + x1] * fx
  return top * (1 - fy) + bottom * fy
}

function sampleFlow(values: Float32Array, width: number, height: number, x: number, y: number): [number, number] {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return [Number.NaN, Number.NaN]
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const sample = (channel: number): number => {
    const top = values[(y0 * width + x0) * 2 + channel] * (1 - fx)
      + values[(y0 * width + x1) * 2 + channel] * fx
    const bottom = values[(y1 * width + x0) * 2 + channel] * (1 - fx)
      + values[(y1 * width + x1) * 2 + channel] * fx
    return top * (1 - fy) + bottom * fy
  }
  return [sample(0), sample(1)]
}

function activeArea(mask: Uint8Array): number {
  let count = 0
  for (const value of mask) if (value >= 32) count += 1
  return count
}

export function resizeMask(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8Array {
  if (source.length !== sourceWidth * sourceHeight) throw new Error('蒙版缩放数据尺寸不一致')
  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) * sourceHeight / height - 0.5))
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) * sourceWidth / width - 0.5))
      output[y * width + x] = Math.round(sampleScalar(source, sourceWidth, sourceHeight, sourceX, sourceY))
    }
  }
  return output
}

export function estimateDenseMaskStep(
  cv: any,
  previousFrame: any,
  nextFrame: any,
  currentMask: Uint8Array,
  currentGuide: Uint8Array,
  width: number,
  height: number,
): DenseTrackingStep | DenseTrackingFailure {
  const forward = new cv.Mat()
  const backward = new cv.Mat()
  try {
    cv.calcOpticalFlowFarneback(previousFrame, nextFrame, forward, 0.5, 4, 19, 3, 7, 1.5, 0)
    cv.calcOpticalFlowFarneback(nextFrame, previousFrame, backward, 0.5, 4, 19, 3, 7, 1.5, 0)
    const forwardFlow = forward.data32F as Float32Array
    const backwardFlow = backward.data32F as Float32Array
    if (forwardFlow.length !== width * height * 2 || backwardFlow.length !== width * height * 2) {
      return { ok: false, reason: '无法计算画面运动，已停止追踪' }
    }

    const nextMask = new Uint8Array(width * height)
    const nextGuide = new Uint8Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 2
        const sourceX = x + backwardFlow[offset]
        const sourceY = y + backwardFlow[offset + 1]
        nextMask[y * width + x] = Math.round(sampleScalar(currentMask, width, height, sourceX, sourceY))
        nextGuide[y * width + x] = Math.round(sampleScalar(currentGuide, width, height, sourceX, sourceY))
      }
    }

    let guideSamples = 0
    let retainedSamples = 0
    let consistentSamples = 0
    let consistencyQuality = 0
    let photoQuality = 0
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (currentGuide[y * width + x] < 32) continue
        guideSamples += 1
        const offset = (y * width + x) * 2
        const nextX = x + forwardFlow[offset]
        const nextY = y + forwardFlow[offset + 1]
        if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) continue
        if (nextX < 0 || nextY < 0 || nextX > width - 1 || nextY > height - 1) continue
        retainedSamples += 1
        const [backX, backY] = sampleFlow(backwardFlow, width, height, nextX, nextY)
        const fbError = Math.hypot(forwardFlow[offset] + backX, forwardFlow[offset + 1] + backY)
        if (Number.isFinite(fbError)) {
          if (fbError <= 3) consistentSamples += 1
          consistencyQuality += Math.exp(-Math.min(8, fbError) / 1.5)
        }
        const brightnessError = Math.abs(previousFrame.data[y * width + x]
          - sampleScalar(nextFrame.data, width, height, nextX, nextY))
        photoQuality += Math.exp(-brightnessError / 28)
      }
    }
    if (guideSamples < 16 || retainedSamples < 12) return { ok: false, reason: '人物轮廓已离开画面，已停止追踪' }
    const retainedRatio = retainedSamples / guideSamples
    const consistentRatio = consistentSamples / retainedSamples
    const areaBefore = activeArea(currentGuide)
    const areaAfter = activeArea(nextGuide)
    const areaRatio = areaBefore > 0 ? areaAfter / areaBefore : 0
    const areaQuality = Math.exp(-Math.abs(Math.log(Math.max(0.001, areaRatio))) * 2)
    const confidence = Math.max(0, Math.min(1,
      retainedRatio * 0.2
      + consistentRatio * 0.3
      + consistencyQuality / retainedSamples * 0.2
      + photoQuality / retainedSamples * 0.15
      + areaQuality * 0.15,
    ))
    if (retainedRatio < 0.58 || consistentRatio < 0.5 || areaRatio < 0.62 || areaRatio > 1.45 || confidence < 0.55) {
      return { ok: false, reason: '人物运动变化较大，已在蒙版漂移前停止' }
    }
    if (activeArea(nextMask) < 8) return { ok: false, reason: '皮肤区域已丢失，已停止追踪' }
    return { ok: true, mask: nextMask, guide: nextGuide, confidence }
  } finally {
    forward.delete()
    backward.delete()
  }
}

interface DenseTrackingRunInput {
  anchorTime: number
  endTime?: number
  duration: number
  maskWidth: number
  maskHeight: number
  maskBytes: Uint8Array
  guideMaskBytes: Uint8Array
  guideMaskWidth: number
  guideMaskHeight: number
}

export async function runDenseMaskTracking(
  cv: any,
  input: DenseTrackingRunInput,
  width: number,
  height: number,
  sampleRate: number,
  chunkSeconds: number,
  decodeFrames: (start: number, duration: number, width: number, height: number) => Promise<Buffer[]>,
  onProgress: (time: number, confidence: number, percent: number) => void,
): Promise<{
  masks: Array<{ time: number; width: number; height: number; bytes: Uint8Array; confidence: number }>
  stoppedReason?: string
  completed: boolean
}> {
  const anchorFrames = await decodeFrames(input.anchorTime, 1 / sampleRate, width, height)
  if (anchorFrames.length === 0) throw new Error('无法读取当前视频帧')
  let currentFrame = new cv.Mat(height, width, cv.CV_8UC1)
  currentFrame.data.set(anchorFrames[0])
  let currentMask = resizeMask(input.maskBytes, input.maskWidth, input.maskHeight, width, height)
  let currentGuide = resizeMask(input.guideMaskBytes, input.guideMaskWidth, input.guideMaskHeight, width, height)
  let currentTime = input.anchorTime
  let stoppedReason: string | undefined
  const masks: Array<{ time: number; width: number; height: number; bytes: Uint8Array; confidence: number }> = []
  const forwardEnd = Math.min(input.duration, input.endTime ?? input.duration)
  const targetSpan = forwardEnd - input.anchorTime
  try {
    while (currentTime < forwardEnd - 0.0001) {
      const chunkStart = currentTime + 1 / sampleRate
      const chunkEnd = Math.min(forwardEnd, chunkStart + chunkSeconds)
      const decoded = await decodeFrames(chunkStart, Math.max(1 / sampleRate, chunkEnd - chunkStart), width, height)
      const scheduled = decoded.map((bytes, index) => ({
        bytes,
        time: Math.min(input.duration, chunkStart + index / sampleRate),
      }))
      if (scheduled.length === 0) break
      for (const item of scheduled) {
        if (item.time <= currentTime + 0.0001 || item.time > forwardEnd + 0.0001) continue
        const nextFrame = new cv.Mat(height, width, cv.CV_8UC1)
        nextFrame.data.set(item.bytes)
        const step = estimateDenseMaskStep(cv, currentFrame, nextFrame, currentMask, currentGuide, width, height)
        if (!step.ok) {
          stoppedReason = step.reason
          nextFrame.delete()
          break
        }
        currentFrame.delete()
        currentFrame = nextFrame
        currentMask = step.mask
        currentGuide = step.guide
        currentTime = item.time
        masks.push({
          time: currentTime,
          width: input.maskWidth,
          height: input.maskHeight,
          bytes: resizeMask(currentMask, width, height, input.maskWidth, input.maskHeight),
          confidence: step.confidence,
        })
        const completed = targetSpan <= 0 ? 1 : (currentTime - input.anchorTime) / targetSpan
        onProgress(currentTime, step.confidence, Math.min(100, Math.round(completed * 100)))
      }
      if (stoppedReason) break
    }
  } finally {
    currentFrame.delete()
  }
  return {
    masks,
    stoppedReason,
    completed: !stoppedReason && currentTime >= forwardEnd - 1 / sampleRate - 0.0001,
  }
}
