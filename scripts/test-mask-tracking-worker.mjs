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
  async function track(direction, anchorTime, initialTransform, sourcePath = videoPath) {
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
        anchorTime, duration: 2, sourceWidth: 320, sourceHeight: 240,
        maskWidth: 320, maskHeight: 240, maskBytes, initialTransform,
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
  console.log(`mask tracking worker test passed (${result.keyframes.length} forward, ${backward.result.keyframes.length} backward keyframes)`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
