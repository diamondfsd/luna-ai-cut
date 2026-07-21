import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
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
  async function track(direction, anchorTime, initialTransform) {
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
        requestId: `smoke-${direction}`, ffmpegPath, filePath: videoPath, direction,
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
  console.log(`mask tracking worker test passed (${result.keyframes.length} forward, ${backward.result.keyframes.length} backward keyframes)`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
