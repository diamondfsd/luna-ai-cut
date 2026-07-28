import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const native = require(path.join(projectRoot, 'luna-render-core/luna-render-core.node'))
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const sourcePath = process.argv[2]
const outputDir = process.argv[3]

if (!sourcePath || !outputDir) {
  throw new Error('usage: node scripts/render-pixel-flow-reference.mjs <source-image> <output-dir>')
}

mkdirSync(outputDir, { recursive: true })
const duration = 1.05
const composition = {
  version: 1,
  canvas: { width: 1280, height: 720, duration, fps: 60 },
  layers: [{
    id: 'pixel-flow-reference',
    layerType: 'pixel-flow',
    source: { path: sourcePath, sourceType: 'image' },
    rect: { x: 0, y: 0, w: 1, h: 1 },
    fit: 'stretch',
    opacity: 1,
    zIndex: 0,
    pixelFlow: {
      duration,
      pixelCount: 240,
      lightWidth: 8,
      rainSpeed: 50,
      rainLength: 58,
      flowStrength: 78,
      subjectDelay: 34,
      bloomStrength: 28,
      filterStrength: 50,
      colorTransition: 0.5,
      segmented: false,
    },
  }],
}

native.initCompositor()
const times = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05]
for (const [index, time] of times.entries()) {
  const frame = native.renderCompositionFrame({
    ffmpegPath,
    ffprobePath,
    composition,
    time,
    maxSide: 1280,
  })
  const rawPath = path.join(outputDir, `${String(index + 1).padStart(2, '0')}.rgba`)
  const pngPath = path.join(outputDir, `${String(index + 1).padStart(2, '0')}.png`)
  writeFileSync(rawPath, Buffer.from(frame.data))
  const converted = spawnSync(ffmpegPath, [
    '-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${frame.width}x${frame.height}`, '-i', rawPath, '-frames:v', '1', pngPath,
  ])
  if (converted.status !== 0) throw new Error(converted.stderr.toString())
}

console.log(`pixel-flow reference frames: ${outputDir}`)
