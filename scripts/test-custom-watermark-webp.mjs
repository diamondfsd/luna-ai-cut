import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

import { convertWebpWatermarkToPng, probeWatermarkImage } from '../electron/export/watermark/customWatermarkImage.ts'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const temporary = await mkdtemp(path.join(tmpdir(), 'luna-watermark-webp-'))

try {
  const webpPath = path.join(temporary, 'transparent.webp')
  const pngPath = path.join(temporary, 'converted.staging.png')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'color=c=red@0.5:s=32x24:d=1,format=rgba',
    '-frames:v', '1',
    '-c:v', 'libwebp',
    '-lossless', '1',
    '-y',
    webpPath,
  ])

  assert.deepEqual(await probeWatermarkImage(webpPath, ffprobePath), { width: 32, height: 24 })
  await convertWebpWatermarkToPng(webpPath, pngPath, ffmpegPath)
  assert.deepEqual(await probeWatermarkImage(pngPath, ffprobePath), { width: 32, height: 24 })
  assert.deepEqual([...await readFile(pngPath).then((bytes) => bytes.subarray(0, 8))], [137, 80, 78, 71, 13, 10, 26, 10])
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', pngPath,
  ])
  assert.equal(stdout.trim(), 'rgba')
  console.log('custom watermark WebP conversion tests passed')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
