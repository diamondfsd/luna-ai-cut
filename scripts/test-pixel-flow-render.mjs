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
      const black = x < 24 && y >= 60 && y < 84
      const highlight = x >= 90 && x < 110 && y >= 48 && y < 66
      const color = black ? [0, 0, 0] : highlight ? [245, 210, 96] : subject ? [32, 205, 76] : sky ? [42, 126, 224] : [226, 48, 82]
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

function averageBrightness(frame, x0, y0, x1, y1) {
  let total = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += brightness(frame, x, y)
      count += 1
    }
  }
  return total / count
}

function frameDifference(first, second) {
  let difference = 0
  for (let index = 0; index < first.data.length; index += 1) {
    difference += Math.abs(first.data[index] - second.data[index])
  }
  return difference / first.data.length
}

function render(composition, time) {
  return native.renderCompositionFrame({ ffmpegPath, ffprobePath, composition, time, maxSide: width })
}

function compositionWithModes(composition, skyMode, otherDirection) {
  const copy = structuredClone(composition)
  copy.layers[0].pixelFlow.skyMode = skyMode
  copy.layers[0].pixelFlow.otherDirection = otherDirection
  return copy
}

function wholeFrameComposition(composition, trajectory = 'highlight-flow') {
  const copy = structuredClone(composition)
  delete copy.layers[0].maskPath
  copy.layers[0].pixelFlow.flowMode = 'whole-frame'
  copy.layers[0].pixelFlow.trajectory = trajectory
  copy.layers[0].pixelFlow.depthStrength = 100
  copy.layers[0].pixelFlow.originX = 0.5
  copy.layers[0].pixelFlow.originY = 0.06
  copy.layers[0].pixelFlow.impactX = 0.5
  copy.layers[0].pixelFlow.impactY = 0.14
  return copy
}

function compositionWithPixelFlow(composition, values) {
  const copy = structuredClone(composition)
  Object.assign(copy.layers[0].pixelFlow, values)
  return copy
}

function compositionWithoutPixelFlow(composition) {
  const copy = structuredClone(composition)
  delete copy.layers[0].pixelFlow
  delete copy.layers[0].maskPath
  copy.layers[0].layerType = 'media'
  return copy
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
        flowMode: 'segmented',
        skyMode: 'ripple',
        otherDirection: 'top-down',
        pixelSize: 12,
        lightWidth: 7,
        depthStrength: 44,
        originX: 0.5,
        originY: 0.18,
        impactX: 0.5,
        impactY: 0.42,
        skyScale: 1,
        backgroundScale: 1,
        subjectScale: 1,
        skyBlackRatio: 0,
        bloomStrength: 50,
        filterStrength: 50,
        colorTransition: 0.5,
      },
    }],
  }

  native.initCompositor()
  const initial = render(composition, 0)
  const falling = render(composition, duration * 0.12)
  const verticalWave = render(composition, duration * 0.55)
  const edgeHold = render(composition, duration * 0.62)
  const background = render(composition, duration * 0.68)
  const subject = render(composition, duration * 0.8)
  const finished = render(composition, duration)
  const skySweep = render(compositionWithModes(composition, 'sweep', 'top-down'), duration * 0.18)
  const skyFull = render(compositionWithModes(composition, 'full', 'top-down'), duration * 0.18)
  const outsideIn = render(compositionWithModes(composition, 'ripple', 'outside-in'), duration * 0.48)
  const insideOut = render(compositionWithModes(composition, 'ripple', 'inside-out'), duration * 0.44)
  const normalSkySpeed = render(composition, duration * 0.14)
  const darkSkyComposition = compositionWithModes(composition, 'ripple', 'top-down')
  darkSkyComposition.layers[0].pixelFlow.skyBlackRatio = 0.9
  const darkSkySpeed = render(darkSkyComposition, duration * 0.14)
  const wholeFrameEarly = render(wholeFrameComposition(composition), duration * 0.28)
  const wholeFrameMiddle = render(wholeFrameComposition(composition), duration * 0.48)
  const diagonalFlow = render(wholeFrameComposition(composition, 'diagonal'), duration * 0.32)
  const splitFlow = render(wholeFrameComposition(composition, 'split'), duration * 0.28)
  const bloomOff = render(compositionWithPixelFlow(composition, { bloomStrength: 0 }), duration * 0.55)
  const bloomFull = render(compositionWithPixelFlow(composition, { bloomStrength: 100 }), duration * 0.55)
  const filterOff = render(compositionWithPixelFlow(composition, { filterStrength: 0 }), duration)
  const filterFull = render(compositionWithPixelFlow(composition, { filterStrength: 100 }), duration)
  const instantColor = render(compositionWithPixelFlow(composition, { colorTransition: 0 }), duration * 0.3)
  const gradualColor = render(compositionWithPixelFlow(composition, { colorTransition: 0.8 }), duration * 0.3)
  const plainComposition = compositionWithoutPixelFlow(composition)
  const plainStart = render(plainComposition, 0)
  const plainEnd = render(plainComposition, duration)
  for (const frame of [initial, falling, verticalWave, edgeHold, background, subject, finished]) {
    assert.equal(frame.width, width)
    assert.equal(frame.height, height)
  }
  assert.ok(brightness(falling, 64, 24) > brightness(falling, 20, 34) + 40, 'the sky center explodes before the surrounding sky')
  assert.ok(brightness(verticalWave, 64, 54) > brightness(verticalWave, 64, 108) + 40, 'non-sky regions flow from top to bottom')
  const edgeAfterglow = brightness(edgeHold, 8, 54) - brightness(finished, 8, 54)
  const centerAfterglow = brightness(edgeHold, 64, 54) - brightness(finished, 64, 54)
  assert.ok(edgeAfterglow > centerAfterglow + 10, 'the outer edge keeps glowing after the inner wave fades')
  const backgroundBlockBrightness = [30, 42, 54, 78, 90, 102, 114].map((x) => brightness(verticalWave, x, 54))
  assert.ok(Math.max(...backgroundBlockBrightness) - Math.min(...backgroundBlockBrightness) > 80, 'the fixed half-bright half-dim split creates block contrast')
  assert.ok(colorfulness(background, 78, 54) > colorfulness(background, 64, 88) + 25, 'the background wave reaches before the subject')
  assert.ok(brightness(background, 12, 70) <= brightness(initial, 12, 70) + 3, 'black source blocks do not emit a pixel-flow glow')
  assert.ok(colorfulness(subject, 64, 88) > colorfulness(initial, 64, 88) + 40, 'the subject lights in the foreground stage')
  assert.ok(colorfulness(finished, 64, 88) > colorfulness(initial, 64, 88) + 40, 'the final frame preserves the revealed subject color')
  assert.ok(brightness(skySweep, 18, 24) > brightness(skySweep, 102, 24) + 40, 'the sky sweep moves from left to right')
  assert.ok(brightness(skyFull, 18, 24) > brightness(initial, 18, 24) + 40, 'the full-sky preset lights the whole sky together')
  assert.ok(brightness(outsideIn, 18, 54) > brightness(outsideIn, 66, 54) + 40, 'the outside-in preset reaches the edge before the center')
  assert.ok(brightness(insideOut, 66, 54) > brightness(insideOut, 18, 54) + 40, 'the inside-out preset reaches the center before the edge')
  assert.ok(brightness(darkSkySpeed, 18, 34) > brightness(normalSkySpeed, 18, 34) + 40, 'a mostly black sky advances faster than a regular sky')
  assert.ok(brightness(wholeFrameEarly, 64, 24) > brightness(wholeFrameEarly, 10, 24) + 30, 'whole-frame flow expands from the upper center')
  assert.ok(colorfulness(wholeFrameMiddle, 64, 54) > colorfulness(wholeFrameMiddle, 64, 108) + 30, 'whole-frame flow falls from top to bottom without semantic staging')
  assert.ok(brightness(diagonalFlow, 106, 42) > brightness(diagonalFlow, 18, 42) + 30, 'the diagonal preset travels from the upper right')
  assert.ok(brightness(splitFlow, 64, 24) > brightness(splitFlow, 10, 24) + 30, 'the split preset branches outward from the center')
  const highlightBrightness = averageBrightness(verticalWave, 92, 50, 108, 64)
  const finishedHighlightBrightness = averageBrightness(finished, 92, 50, 108, 64)
  assert.ok(highlightBrightness > finishedHighlightBrightness + 70, 'the broad underlight strongly lifts source highlights')
  assert.ok(averageBrightness(bloomFull, 88, 46, 112, 68) > averageBrightness(bloomOff, 88, 46, 112, 68) + 35, 'CCD bloom strength controls the wide highlight field')
  assert.ok(frameDifference(filterOff, filterFull) > 8, 'the Hertz color strength changes the final color grade')
  assert.ok(frameDifference(instantColor, gradualColor) > 5, 'the color transition remains independent from the pixel wave')
  assert.deepEqual(plainStart.data, plainEnd.data, 'layers without pixel flow remain unaffected by pixel-flow timing and finishing')
  console.log('pixel-flow WGPU render stages passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
