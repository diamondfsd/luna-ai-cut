import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const native = require(path.join(projectRoot, 'luna-render-core/luna-render-core.node'))
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const execFileAsync = promisify(execFile)
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-pixel-flow-'))
const width = 128
const height = 128
const duration = 1.05

function sourceImage() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const subject = Math.hypot(x - 64, y - 88) <= 18
      const sky = y < 45
      const black = x < 24 && (y < 45 || (y >= 60 && y < 84))
      const highlight = x >= 90 && x < 110 && y >= 48 && y < 66
      const color = black ? [0, 0, 0] : highlight ? [245, 210, 96] : subject ? [32, 205, 76] : sky ? [42, 126, 224] : [226, 48, 82]
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
}

function depthMaskImage() {
  const pixels = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const subject = Math.hypot(x - 64, y - 88) <= 18
      pixels[y * width + x] = subject ? 224 : y < 45 ? 32 : 128
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

function regionDifference(first, second, y0, y1) {
  let difference = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      difference += Math.abs(first.data[offset] - second.data[offset])
        + Math.abs(first.data[offset + 1] - second.data[offset + 1])
        + Math.abs(first.data[offset + 2] - second.data[offset + 2])
      count += 3
    }
  }
  return difference / count
}

function rectangleDifference(first, second, x0, y0, x1, y1) {
  let difference = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4
      difference += Math.abs(first.data[offset] - second.data[offset])
        + Math.abs(first.data[offset + 1] - second.data[offset + 1])
        + Math.abs(first.data[offset + 2] - second.data[offset + 2])
      count += 3
    }
  }
  return difference / count
}

function averageColorfulness(frame) {
  let total = 0
  for (let index = 0; index < frame.data.length; index += 4) {
    const channels = [frame.data[index], frame.data[index + 1], frame.data[index + 2]]
    total += Math.max(...channels) - Math.min(...channels)
  }
  return total / (frame.data.length / 4)
}

function regionColorfulness(frame, y0, y1) {
  let total = 0
  let count = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      total += colorfulness(frame, x, y)
      count += 1
    }
  }
  return total / count
}

function render(composition, time) {
  return native.renderCompositionFrame({ ffmpegPath, ffprobePath, composition, time, maxSide: width })
}

function compositionWithPixelFlow(composition, values) {
  const copy = structuredClone(composition)
  Object.assign(copy.layers[0].pixelFlow, values)
  return copy
}

function compositionWithoutPixelFlow(composition) {
  const copy = structuredClone(composition)
  delete copy.layers[0].pixelFlow
  copy.layers[0].layerType = 'media'
  return copy
}

try {
  const sourcePath = path.join(temporaryRoot, 'scene.ppm')
  const depthPath = path.join(temporaryRoot, 'depth.pgm')
  await Promise.all([writeFile(sourcePath, sourceImage()), writeFile(depthPath, depthMaskImage())])
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
      pixelFlow: {
        duration,
        pixelCount: 160,
        lightWidth: 8,
        initialSaturation: 0,
        initialBrightness: 0,
        subjectDirection: 'down',
        rainSpeed: 50,
        rainLength: 58,
        flowStrength: 78,
        subjectDelay: 34,
        bloomStrength: 28,
        filterStrength: 50,
        colorTransition: 0.5,
      },
    }],
  }

  native.initCompositor()
  const initial = render(composition, 0)
  const saturatedInitial = render(compositionWithPixelFlow(composition, { initialSaturation: 100 }), 0)
  const brighterInitial = render(compositionWithPixelFlow(composition, { initialBrightness: 50 }), 0)
  const ignition = render(composition, 0.2)
  const spreading = render(composition, 0.5)
  const finished = render(composition, duration)
  const slowRain = render(compositionWithPixelFlow(composition, { rainSpeed: 20 }), 0.45)
  const fastRain = render(compositionWithPixelFlow(composition, { rainSpeed: 90 }), 0.45)
  const shortRain = render(compositionWithPixelFlow(composition, { rainLength: 10 }), 0.42)
  const longRain = render(compositionWithPixelFlow(composition, { rainLength: 100 }), 0.42)
  const flowLow = render(compositionWithPixelFlow(composition, { flowStrength: 20, bloomStrength: 0 }), 0.36)
  const flowFull = render(compositionWithPixelFlow(composition, { flowStrength: 100, bloomStrength: 0 }), 0.36)
  const bloomOff = render(compositionWithPixelFlow(composition, { bloomStrength: 0 }), 0.42)
  const bloomFull = render(compositionWithPixelFlow(composition, { bloomStrength: 100 }), 0.42)
  const finishedBloomOff = render(compositionWithPixelFlow(composition, { bloomStrength: 0 }), duration)
  const finishedBloomFull = render(compositionWithPixelFlow(composition, { bloomStrength: 100 }), duration)
  const filterOff = render(compositionWithPixelFlow(composition, { filterStrength: 0 }), duration)
  const filterFull = render(compositionWithPixelFlow(composition, { filterStrength: 100 }), duration)
  const fastColor = render(compositionWithPixelFlow(composition, { colorTransition: 0.1, flowStrength: 20, bloomStrength: 0 }), 0.52)
  const gradualColor = render(compositionWithPixelFlow(composition, { colorTransition: 0.8, flowStrength: 20, bloomStrength: 0 }), 0.52)
  const localColorReveal = render(compositionWithPixelFlow(composition, { flowStrength: 0, bloomStrength: 0 }), 0.3)
  const segmented = structuredClone(composition)
  segmented.layers[0].maskPath = depthPath
  segmented.layers[0].pixelFlow.segmented = true
  const immediateSubject = render(compositionWithPixelFlow(segmented, { subjectDelay: 0 }), 0.55)
  const delayedSubject = render(compositionWithPixelFlow(segmented, { subjectDelay: 100 }), 0.55)
  const subjectRight = render(compositionWithPixelFlow(segmented, { subjectDirection: 'right' }), 0.48)
  const subjectLeft = render(compositionWithPixelFlow(segmented, { subjectDirection: 'left' }), 0.48)
  const plainComposition = compositionWithoutPixelFlow(composition)
  const plainStart = render(plainComposition, 0)
  const plainEnd = render(plainComposition, duration)
  for (const frame of [initial, ignition, spreading, finished]) {
    assert.equal(frame.width, width)
    assert.equal(frame.height, height)
  }
  assert.ok(colorfulness(initial, 64, 88) < 5, 'the effect starts from a monochrome plate')
  assert.ok(averageColorfulness(saturatedInitial) > averageColorfulness(initial) + 35, 'initial saturation restores source color before the effect')
  assert.ok(averageBrightness(brighterInitial, 0, 0, width, height) > averageBrightness(initial, 0, 0, width, height) + 100, 'initial brightness lifts the starting plate')
  const upperRain = regionDifference(ignition, initial, 0, 48)
  const lowerRain = regionDifference(ignition, initial, 88, 128)
  assert.ok(upperRain > lowerRain + 4, `pixel rain reaches the upper frame first (${upperRain} > ${lowerRain})`)
  const blackSkyRain = rectangleDifference(ignition, initial, 0, 0, 16, 40)
  const coloredSkyRain = rectangleDifference(ignition, initial, 32, 0, 120, 40)
  assert.ok(blackSkyRain < coloredSkyRain * 0.18, `black source areas do not generate rain (${blackSkyRain} < ${coloredSkyRain})`)
  const speedDifference = frameDifference(slowRain, fastRain)
  const lengthDifference = frameDifference(shortRain, longRain)
  assert.ok(speedDifference > 0.8, `rain speed changes the vertical flow position (${speedDifference})`)
  assert.ok(lengthDifference > 0.3, `rain length changes the vertical stream tails (${lengthDifference})`)
  const flowDifference = frameDifference(flowLow, flowFull)
  assert.ok(flowDifference > 1, `surface flow controls the source-colored pixel layer (${flowDifference})`)
  assert.ok(colorfulness(finished, 64, 88) > colorfulness(initial, 64, 88) + 40, 'the final frame preserves full color')
  const bloomBrightnessLift = averageBrightness(bloomFull, 88, 46, 112, 68) - averageBrightness(bloomOff, 88, 46, 112, 68)
  assert.ok(bloomBrightnessLift > 2, `CCD bloom lifts the active rain front (${bloomBrightnessLift})`)
  const finishedBloomDifference = frameDifference(finishedBloomOff, finishedBloomFull)
  assert.ok(finishedBloomDifference > 0.01, `CCD remains restrained but active on the final composite (${finishedBloomDifference})`)
  assert.ok(frameDifference(filterOff, filterFull) > 8, 'the Hertz color strength changes the final color grade')
  assert.ok(frameDifference(fastColor, gradualColor) > 5, 'the 30-frame color transition remains independent from the pixel rain')
  const revealedSkyColor = regionColorfulness(localColorReveal, 0, 40)
  const unrevealedLowerColor = regionColorfulness(localColorReveal, 92, 128)
  assert.ok(revealedSkyColor > unrevealedLowerColor + 8, `source color follows the local pixel front (${revealedSkyColor} > ${unrevealedLowerColor})`)
  const subjectDifference = rectangleDifference(immediateSubject, delayedSubject, 46, 70, 82, 106)
  assert.ok(subjectDifference > 0.5, `the segmented subject keeps its own delayed surface flow (${subjectDifference})`)
  const subjectDirectionDifference = rectangleDifference(subjectRight, subjectLeft, 46, 70, 82, 106)
  const skyDirectionDifference = rectangleDifference(subjectRight, subjectLeft, 0, 0, width, 44)
  assert.ok(subjectDirectionDifference > 1, `subject direction presets change the foreground scan (${subjectDirectionDifference})`)
  assert.ok(skyDirectionDifference < 0.05, `subject direction leaves the downward sky rain unchanged (${skyDirectionDifference})`)
  assert.deepEqual(plainStart.data, plainEnd.data, 'layers without pixel flow remain unaffected by pixel-flow timing and finishing')

  const liveComposition = structuredClone(composition)
  liveComposition.canvas.duration = 3
  const liveVideoPath = path.join(temporaryRoot, 'pixel-flow-live.mp4')
  await native.exportCompositionVideoAsync({
    ffmpegPath,
    ffprobePath,
    outputPath: liveVideoPath,
    composition: liveComposition,
    fps: 30,
    duration: 3,
    hardware: false,
    taskId: 'pixel-flow-live-test',
    qualityPreset: 'small',
  })
  const { stdout: exportedDuration } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', liveVideoPath,
  ])
  assert.ok(Math.abs(Number(exportedDuration.trim()) - 3) < 0.08, `still-image Live motion renders for 3 seconds (${exportedDuration.trim()})`)
  console.log('pixel-flow source-color rain stages passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
