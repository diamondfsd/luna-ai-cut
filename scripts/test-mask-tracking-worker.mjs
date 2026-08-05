/* eslint-disable no-inner-declarations -- test helper is scoped to temporary assets created by this run. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'luna-mask-track-'))

try {
  const videoPath = join(temporaryRoot, 'sample.mp4')
  const generated = spawnSync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=8:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
  ], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)

  const staticImagePath = join(temporaryRoot, 'static.ppm')
  const staticVideoPath = join(temporaryRoot, 'static.mp4')
  const staticPixels = Buffer.alloc(320 * 240 * 3)
  for (let y = 0; y < 240; y += 1) {
    for (let x = 0; x < 320; x += 1) {
      const offset = (y * 320 + x) * 3
      const checker = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0
      staticPixels[offset] = checker ? 230 : 25
      staticPixels[offset + 1] = (x * 7 + y * 3) % 256
      staticPixels[offset + 2] = checker ? 40 : 210
    }
  }
  await writeFile(staticImagePath, Buffer.concat([Buffer.from('P6\n320 240\n255\n'), staticPixels]))
  const generatedStatic = spawnSync(ffmpegPath, [
    '-y', '-loop', '1', '-framerate', '8', '-i', staticImagePath, '-t', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', staticVideoPath,
  ], { encoding: 'utf8' })
  assert.equal(generatedStatic.status, 0, generatedStatic.stderr)

  const panImagePath = join(temporaryRoot, 'pan.ppm')
  const panVideoPath = join(temporaryRoot, 'pan.mp4')
  const panPixels = Buffer.alloc(400 * 240 * 3)
  for (let y = 0; y < 240; y += 1) {
    for (let x = 0; x < 400; x += 1) {
      const offset = (y * 400 + x) * 3
      const checker = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0
      panPixels[offset] = checker ? 220 : 30
      panPixels[offset + 1] = (x * 11 + y * 5) % 256
      panPixels[offset + 2] = checker ? 55 : 205
    }
  }
  await writeFile(panImagePath, Buffer.concat([Buffer.from('P6\n400 240\n255\n'), panPixels]))
  const generatedPan = spawnSync(ffmpegPath, [
    '-y', '-loop', '1', '-framerate', '8', '-i', panImagePath, '-t', '2',
    '-vf', "crop=320:240:x='20*t':y=0", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', panVideoPath,
  ], { encoding: 'utf8' })
  assert.equal(generatedPan.status, 0, generatedPan.stderr)

  const deformVideoPath = join(temporaryRoot, 'deform.mp4')
  const deformFrames = []
  const deformMasks = []
  const movingParts = (frame) => [
    { x: 135, y: 70, width: 50, height: 100 },
    { x: 100, y: 65 + frame * 4, width: 35, height: 110 },
    { x: 185, y: 65 - frame * 4, width: 35, height: 110 },
  ]
  for (let frame = 0; frame < 16; frame += 1) {
    const pixels = Buffer.alloc(320 * 240 * 3)
    const frameMask = new Uint8Array(320 * 240)
    for (let y = 0; y < 240; y += 1) {
      for (let x = 0; x < 320; x += 1) {
        const offset = (y * 320 + x) * 3
        const background = 25 + ((Math.floor(x / 10) + Math.floor(y / 10)) % 2) * 18
        pixels[offset] = background
        pixels[offset + 1] = background + 7
        pixels[offset + 2] = background + 12
      }
    }
    for (const [partIndex, part] of movingParts(frame).entries()) {
      for (let y = Math.max(0, part.y); y < Math.min(240, part.y + part.height); y += 1) {
        for (let x = part.x; x < part.x + part.width; x += 1) {
          const localX = x - part.x
          const localY = y - part.y
          const offset = (y * 320 + x) * 3
          pixels[offset] = 90 + (localX * 13 + localY * 7 + partIndex * 31) % 150
          pixels[offset + 1] = 55 + (localX * 5 + localY * 17 + partIndex * 19) % 170
          pixels[offset + 2] = 45 + (localX * 11 + localY * 3 + partIndex * 43) % 180
          frameMask[y * 320 + x] = 255
        }
      }
    }
    deformFrames.push(pixels)
    deformMasks.push(frameMask)
  }
  const generatedDeform = spawnSync(ffmpegPath, [
    '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '320x240', '-r', '8', '-i', 'pipe:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', deformVideoPath,
  ], { input: Buffer.concat(deformFrames), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  assert.equal(generatedDeform.status, 0, generatedDeform.stderr)

  const workerCandidates = (await readdir(resolve('dist-electron/assets')))
    .filter((name) => name.startsWith('maskTrackingWorker-'))
  const workerName = (await Promise.all(workerCandidates.map(async (name) => ({
    name,
    modifiedAt: (await stat(resolve('dist-electron/assets', name))).mtimeMs,
  })))).sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.name
  assert.ok(workerName, 'the production build must contain the mask tracking worker')

  const maskBytes = new Uint8Array(320 * 240)
  for (let y = 20; y < 220; y += 1) {
    for (let x = 20; x < 300; x += 1) maskBytes[y * 320 + x] = 255
  }
  async function track(direction, anchorTime, initialTransform, sourcePath = videoPath, endTime, options = {}) {
    const worker = new Worker(new URL(`file://${resolve('dist-electron/assets', workerName)}`), { workerData: null })
    const progress = []
    const result = await new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => reject(new Error('mask tracking worker timed out')), 20_000)
      worker.on('error', reject)
      worker.on('message', (message) => {
        if (message.kind === 'progress') progress.push(message)
        if (message.kind === 'result' || message.kind === 'error') {
          clearTimeout(timer)
          resolveResult(message)
        }
      })
      worker.postMessage({
        requestId: `smoke-${direction}`, ffmpegPath, filePath: sourcePath, direction,
        anchorTime, endTime, duration: 2, sourceWidth: 320, sourceHeight: 240,
        maskWidth: 320, maskHeight: 240, maskBytes, initialTransform,
        ...options,
      })
    })
    await worker.terminate()
    return { result, progress }
  }

  const { result, progress } = await track('forward', 0)

  assert.equal(result.kind, 'result', result.error)
  assert.ok(result.keyframes.length > 2, 'tracking must return multiple trajectory samples')
  assert.ok(progress.length > 0, 'tracking must report progress')
  assert.deepEqual(result.keyframes[0], {
    time: 0, translateX: 0, translateY: 0, scale: 1, rotation: 0, confidence: 1,
  })
  const bounded = await track('forward', 0, undefined, staticVideoPath, 1)
  assert.equal(bounded.result.kind, 'result', bounded.result.error)
  assert.ok(bounded.result.keyframes.length > 2, 'bounded tracking must return multiple trajectory samples')
  assert.ok(bounded.result.keyframes.at(-1).time <= 1.000001, 'bounded tracking must stop at endTime')
  const backward = await track('backward', 1.75, { translateX: 0.05, translateY: 0, scale: 1, rotation: 0 })
  assert.equal(backward.result.kind, 'result', backward.result.error)
  assert.ok(backward.result.keyframes.length > 2, 'backward tracking must return multiple trajectory samples')
  assert.ok(backward.progress.length > 0, 'backward tracking must report progress')
  const backwardAnchor = backward.result.keyframes.find((keyframe) => Math.abs(keyframe.time - 1.75) < 0.000001)
  assert.ok(backwardAnchor, 'backward tracking must retain its anchor keyframe')
  assert.ok(Math.abs(backwardAnchor.translateX - 0.05) < 0.000001, 'tracking must continue from the existing mask transform')
  const stationary = await track('forward', 0, undefined, staticVideoPath)
  assert.equal(stationary.result.kind, 'result', stationary.result.error)
  const stationaryLast = stationary.result.keyframes.at(-1)
  assert.ok(stationaryLast, 'stationary tracking must return a final keyframe')
  assert.ok(Math.abs(stationaryLast.translateX) < 0.01, `stationary horizontal drift is too large: ${stationaryLast.translateX}`)
  assert.ok(Math.abs(stationaryLast.translateY) < 0.01, `stationary vertical drift is too large: ${stationaryLast.translateY}`)
  assert.ok(Math.abs(stationaryLast.scale - 1) < 0.02, `stationary scale drift is too large: ${stationaryLast.scale}`)
  assert.ok(Math.abs(stationaryLast.rotation) < 0.02, `stationary rotation drift is too large: ${stationaryLast.rotation}`)
  const panned = await track('forward', 0, undefined, panVideoPath)
  assert.equal(panned.result.kind, 'result', panned.result.error)
  const pannedLast = panned.result.keyframes.at(-1)
  assert.ok(pannedLast, 'panning tracking must return a final keyframe')
  const expectedPanX = -(20 * pannedLast.time) / 320
  assert.ok(Math.abs(pannedLast.translateX - expectedPanX) < 0.025, `panning horizontal error is too large: expected ${expectedPanX}, got ${pannedLast.translateX}`)
  assert.ok(Math.abs(pannedLast.translateY) < 0.015, `panning vertical drift is too large: ${pannedLast.translateY}`)
  assert.ok(Math.abs(pannedLast.scale - 1) < 0.025, `panning scale drift is too large: ${pannedLast.scale}`)
  assert.ok(Math.abs(pannedLast.rotation) < 0.02, `panning rotation drift is too large: ${pannedLast.rotation}`)
  const dense = await track('forward', 0, undefined, panVideoPath, 1, {
    mode: 'dense-mask', guideMaskBytes: maskBytes, guideMaskWidth: 320, guideMaskHeight: 240,
  })
  assert.equal(dense.result.kind, 'result', dense.result.error)
  assert.ok(dense.result.masks.length > 2, 'dense tracking must return propagated masks')
  assert.ok(dense.result.masks.at(-1).time <= 1.000001, 'dense tracking must stop at endTime')
  assert.ok(dense.result.masks.every((sample) => sample.width === 320 && sample.height === 240 && sample.bytes.length === 320 * 240), 'dense mask dimensions must stay stable')
  const deformOptions = { maskBytes: deformMasks[0] }
  const deformSimilarity = await track('forward', 0, undefined, deformVideoPath, 1, deformOptions)
  const deformDense = await track('forward', 0, undefined, deformVideoPath, 1, {
    ...deformOptions,
    mode: 'dense-mask', guideMaskBytes: deformMasks[0], guideMaskWidth: 320, guideMaskHeight: 240,
  })
  assert.equal(deformSimilarity.result.kind, 'result', deformSimilarity.result.error)
  assert.equal(deformDense.result.kind, 'result', deformDense.result.error)
  const denseMask = deformDense.result.masks.at(-1)?.bytes
  const similarityFrame = deformSimilarity.result.keyframes.at(-1)
  assert.ok(denseMask && similarityFrame, 'both trackers must reach the non-rigid comparison frame')
  const similarityMask = new Uint8Array(320 * 240)
  const cosine = Math.cos(similarityFrame.rotation) * similarityFrame.scale
  const sine = Math.sin(similarityFrame.rotation) * similarityFrame.scale
  for (let y = 0; y < 240; y += 1) {
    for (let x = 0; x < 320; x += 1) {
      if (deformMasks[0][y * 320 + x] === 0) continue
      const targetX = Math.round(cosine * (x - 160) - sine * (y - 120) + 160 + similarityFrame.translateX * 320)
      const targetY = Math.round(sine * (x - 160) + cosine * (y - 120) + 120 + similarityFrame.translateY * 240)
      if (targetX >= 0 && targetX < 320 && targetY >= 0 && targetY < 240) similarityMask[targetY * 320 + targetX] = 255
    }
  }
  const intersectionOverUnion = (actual, expected) => {
    let intersection = 0
    let union = 0
    for (let index = 0; index < actual.length; index += 1) {
      const selected = actual[index] >= 32
      const expectedSelected = expected[index] >= 32
      if (selected && expectedSelected) intersection += 1
      if (selected || expectedSelected) union += 1
    }
    return intersection / union
  }
  const expectedMask = deformMasks[8]
  const denseIou = intersectionOverUnion(denseMask, expectedMask)
  const similarityIou = intersectionOverUnion(similarityMask, expectedMask)
  assert.ok(denseIou > 0.7, `dense non-rigid IoU is too low: ${denseIou}`)
  assert.ok(denseIou > similarityIou + 0.08, `dense tracking must beat similarity tracking: dense=${denseIou}, similarity=${similarityIou}`)
  console.log(`mask tracking worker test passed (${result.keyframes.length} forward, ${backward.result.keyframes.length} backward keyframes)`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
