import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const native = require(path.join(projectRoot, 'luna-render-core/luna-render-core.node'))
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-pixel-flow-'))
const width = 128
const height = 128
const duration = 3.2

function sourceImage() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const subject = Math.hypot(x - 64, y - 88) <= 18
      const sky = y < 45
      const color = subject ? [32, 205, 76] : sky ? [42, 126, 224] : [226, 48, 82]
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
}

function depthMask() {
  const pixels = Buffer.alloc(width * height, 128)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.hypot(x - 64, y - 88) <= 18) pixels[y * width + x] = 224
      else if (y < 45) pixels[y * width + x] = 32
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels])
}

function colorfulness(frame, x, y) {
  const offset = (y * width + x) * 4
  const channels = [frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]]
  return Math.max(...channels) - Math.min(...channels)
}

function brightness(frame, x, y) {
  const offset = (y * width + x) * 4
  return frame.data[offset] + frame.data[offset + 1] + frame.data[offset + 2]
}

function render(composition, time) {
  return native.renderCompositionFrame({ ffmpegPath, ffprobePath, composition, time, maxSide: width })
}

try {
  const sourcePath = path.join(temporaryRoot, 'scene.ppm')
  const maskPath = path.join(temporaryRoot, 'depth.pgm')
  await Promise.all([writeFile(sourcePath, sourceImage()), writeFile(maskPath, depthMask())])
  const composition = {
    version: 1,
    canvas: { width, height, duration, fps: 30 },
    layers: [{
      id: 'pixel-flow',
      layerType: 'pixel-flow',
      source: { path: sourcePath, sourceType: 'image' },
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'stretch',
      opacity: 1,
      zIndex: 0,
      maskPath,
      pixelFlow: {
        duration,
        pixelSize: 12,
        lightWidth: 7,
        depthStrength: 44,
        originX: 0.5,
        originY: 0.18,
        impactX: 0.5,
        impactY: 0.42,
      },
    }],
  }

  native.initCompositor()
  const initial = render(composition, 0)
  const falling = render(composition, duration * 0.25)
  const verticalWave = render(composition, duration * 0.55)
  const edgeHold = render(composition, duration * 0.62)
  const background = render(composition, duration * 0.68)
  const subject = render(composition, duration * 0.8)
  const finished = render(composition, duration)
  for (const frame of [initial, falling, verticalWave, edgeHold, background, subject, finished]) {
    assert.equal(frame.width, width)
    assert.equal(frame.height, height)
  }
  assert.ok(colorfulness(falling, 64, 24) > colorfulness(falling, 20, 34) + 20, 'the sky center explodes before the surrounding sky')
  assert.ok(brightness(verticalWave, 64, 54) > brightness(verticalWave, 64, 108) + 40, 'non-sky regions flow from top to bottom')
  const edgeAfterglow = brightness(edgeHold, 8, 54) - brightness(finished, 8, 54)
  const centerAfterglow = brightness(edgeHold, 64, 54) - brightness(finished, 64, 54)
  assert.ok(edgeAfterglow > centerAfterglow + 10, 'the outer edge keeps glowing after the inner wave fades')
  assert.ok(colorfulness(background, 96, 54) > colorfulness(background, 64, 88) + 25, 'the background wave reaches before the subject')
  assert.ok(colorfulness(subject, 64, 88) > colorfulness(initial, 64, 88) + 40, 'the subject lights in the foreground stage')
  assert.ok(colorfulness(finished, 64, 88) > colorfulness(initial, 64, 88) + 40, 'the final frame preserves the revealed subject color')
  console.log('pixel-flow WGPU render stages passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
