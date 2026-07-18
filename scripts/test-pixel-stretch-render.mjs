import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const native = require(path.join(projectRoot, 'luna-render-core/luna-render-core.node'))
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-pixel-stretch-'))
const outputRoot = process.env.LUNA_PIXEL_STRETCH_OUTPUT_DIR || temporaryRoot
const realImagePath = process.env.LUNA_PIXEL_STRETCH_REAL_IMAGE
let width = 192
let height = 192

function sourcePixels() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const inside = Math.hypot(x - 96, y - 96) <= 34
      if (!inside) {
        pixels[offset] = 17
        pixels[offset + 1] = 29
        pixels[offset + 2] = 43
        continue
      }
      const band = Math.floor((y - 62) / 7) % 5
      const colors = [[239, 68, 68], [250, 204, 21], [34, 197, 94], [14, 165, 233], [168, 85, 247]]
      const color = colors[Math.max(0, band)]
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
}

function maskPixels() {
  const pixels = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = Math.hypot(x - 96, y - 96) <= 34 ? 255 : 0
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels])
}

function layer(sourcePath, overrides = {}) {
  return {
    id: overrides.id ?? 'base',
    layerType: overrides.layerType ?? 'media',
    source: { path: sourcePath, sourceType: 'image' },
    rect: { x: 0, y: 0, w: 1, h: 1 },
    fit: 'cover',
    opacity: 1,
    zIndex: overrides.zIndex ?? 0,
    maskPath: overrides.maskPath,
    maskOpacity: overrides.maskPath ? 1 : undefined,
    maskFeather: 0,
    pixelStretch: overrides.pixelStretch,
  }
}

function rgbaAt(data, x, y) {
  const offset = (y * width + x) * 4
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]
}

function colorDistance(first, second) {
  return Math.abs(first[0] - second[0]) + Math.abs(first[1] - second[1]) + Math.abs(first[2] - second[2])
}

async function renderMode(sourcePath, maskPath, mode, angle = 0, outputName = mode, ribbonSize = 100, originX = 0.5, originY = 0.5) {
  const effectLayers = [
    layer(sourcePath),
    layer(sourcePath, {
      id: `${mode}-stretch`,
      layerType: 'pixel-stretch',
      zIndex: 1,
      maskPath,
      pixelStretch: { mode, intensity: 82, originX, originY, angle, ribbonSize },
    }),
    layer(sourcePath, { id: 'subject', layerType: 'local-color', zIndex: 2, maskPath }),
  ]
  const composition = {
    version: 1,
    canvas: { width, height },
    layers: effectLayers,
  }
  const preview = native.renderCompositionFrame({
    ffmpegPath,
    ffprobePath,
    composition,
    time: 0,
    maxSide: width,
  })
  assert.equal(preview.width, width)
  assert.equal(preview.height, height)
  const outputPath = path.join(outputRoot, `${outputName}.png`)
  await native.exportCompositionImageAsync({
    ffmpegPath,
    ffprobePath,
    outputPath,
    composition,
    format: 'png',
    quality: 100,
  })
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-i', outputPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-frames:v', '1', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: width * height * 8 })
  assert.deepEqual(Buffer.from(stdout), Buffer.from(preview.data), `${mode}: preview and PNG export must match`)
  return { data: Buffer.from(preview.data), outputPath }
}

try {
  await mkdir(outputRoot, { recursive: true })
  let sourcePath = path.join(temporaryRoot, 'subject.ppm')
  const maskPath = path.join(temporaryRoot, 'subject.pgm')
  let realMask = null
  if (realImagePath) {
    sourcePath = path.resolve(realImagePath)
    const { stdout: probeOutput } = await execFileAsync(ffprobePath, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', sourcePath,
    ])
    const stream = JSON.parse(probeOutput).streams?.[0]
    width = stream?.width
    height = stream?.height
    assert.ok(Number.isInteger(width) && Number.isInteger(height), 'real image dimensions must be readable')
    const { stdout: alphaOutput } = await execFileAsync(ffmpegPath, [
      '-v', 'error', '-i', sourcePath, '-vf', 'alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-frames:v', '1', 'pipe:1',
    ], { encoding: 'buffer', maxBuffer: width * height * 2 })
    realMask = Buffer.from(alphaOutput)
    assert.equal(realMask.length, width * height, 'real image alpha must match its dimensions')
    await writeFile(maskPath, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), realMask]))
  } else {
    await Promise.all([writeFile(sourcePath, sourcePixels()), writeFile(maskPath, maskPixels())])
  }
  native.initCompositor()

  if (realMask) {
    const horizontal = await renderMode(sourcePath, maskPath, 'right')
    let comparedPixels = 0
    for (let y = 0; y < height; y += 1) {
      let edgeX = -1
      for (let x = width - 1; x >= 0; x -= 1) {
        if (realMask[y * width + x] > 242) {
          edgeX = x
          break
        }
      }
      const trailStart = Math.max(edgeX + 24, width - 200)
      if (edgeX < 0 || trailStart >= width) continue
      const expected = rgbaAt(horizontal.data, trailStart, y).slice(0, 3)
      for (let x = trailStart + 1; x < width; x += 1) {
        const actual = rgbaAt(horizontal.data, x, y)
        if (actual[3] === 0) continue
        assert.deepEqual(actual.slice(0, 3), expected, `real image row ${y}, x=${x} must keep one color along the stretch direction`)
        comparedPixels += 1
      }
    }
    assert.ok(comparedPixels > width * 20, `real image must verify enough stretched pixels, got ${comparedPixels}`)

    const vertical = await renderMode(sourcePath, maskPath, 'down')
    let comparedVerticalPixels = 0
    for (let x = 0; x < width; x += 1) {
      let edgeY = -1
      for (let y = height - 1; y >= 0; y -= 1) {
        if (realMask[y * width + x] > 242) {
          edgeY = y
          break
        }
      }
      const trailStart = Math.max(edgeY + 24, height - 200)
      if (edgeY < 0 || trailStart >= height) continue
      const expected = rgbaAt(vertical.data, x, trailStart).slice(0, 3)
      for (let y = trailStart + 1; y < height; y += 1) {
        const actual = rgbaAt(vertical.data, x, y)
        if (actual[3] === 0) continue
        assert.deepEqual(actual.slice(0, 3), expected, `real image column ${x}, y=${y} must keep one color along the stretch direction`)
        comparedVerticalPixels += 1
      }
    }
    assert.ok(comparedVerticalPixels > height * 20, `real image must verify enough vertical stretched pixels, got ${comparedVerticalPixels}`)
    await renderMode(sourcePath, maskPath, 'left')
    await renderMode(sourcePath, maskPath, 'up')
    await renderMode(sourcePath, maskPath, 'horizontal')
    await renderMode(sourcePath, maskPath, 'vertical')
    await renderMode(sourcePath, maskPath, 'right', 45, 'right-angle-45')
    await renderMode(sourcePath, maskPath, 'right', 0, 'right-size-50', 50)
    await renderMode(sourcePath, maskPath, 'right', 0, 'right-sample-40', 100, 0.4, 0.5)
    console.log(`real-image pixel stretch tests passed (${comparedPixels} horizontal and ${comparedVerticalPixels} vertical locked-color pixels); outputs: ${outputRoot}`)
    process.exitCode = 0
  } else {

    const background = [17, 29, 43, 255]
    const right = await renderMode(sourcePath, maskPath, 'right')
    assert.ok(colorDistance(rgbaAt(right.data, 170, 96), background) > 80, 'right trail must extend right from the subject')
    assert.ok(colorDistance(rgbaAt(right.data, 20, 96), background) < 8, 'right trail must not mirror to the left')
    assert.deepEqual(rgbaAt(right.data, 135, 96), rgbaAt(right.data, 170, 96), 'one right trail must keep one source-pixel color')

    const left = await renderMode(sourcePath, maskPath, 'left')
    assert.ok(colorDistance(rgbaAt(left.data, 20, 96), background) > 80, 'left trail must extend left from the subject')
    assert.ok(colorDistance(rgbaAt(left.data, 170, 96), background) < 8, 'left trail must not mirror to the right')

    const down = await renderMode(sourcePath, maskPath, 'down')
    assert.ok(colorDistance(rgbaAt(down.data, 96, 170), background) > 80, 'down trail must extend below the subject')
    assert.ok(colorDistance(rgbaAt(down.data, 96, 20), background) < 8, 'down trail must not mirror above the subject')
    assert.deepEqual(rgbaAt(down.data, 96, 135), rgbaAt(down.data, 96, 170), 'one down trail must keep one source-pixel color')

    const up = await renderMode(sourcePath, maskPath, 'up')
    assert.ok(colorDistance(rgbaAt(up.data, 96, 20), background) > 80, 'up trail must extend above the subject')
    assert.ok(colorDistance(rgbaAt(up.data, 96, 170), background) < 8, 'up trail must not mirror below the subject')

    const horizontal = await renderMode(sourcePath, maskPath, 'horizontal')
    assert.ok(colorDistance(rgbaAt(horizontal.data, 20, 96), background) > 80, 'horizontal trail must extend left')
    assert.ok(colorDistance(rgbaAt(horizontal.data, 170, 96), background) > 80, 'horizontal trail must extend right')

    const vertical = await renderMode(sourcePath, maskPath, 'vertical')
    assert.ok(colorDistance(rgbaAt(vertical.data, 96, 20), background) > 80, 'vertical trail must extend up')
    assert.ok(colorDistance(rgbaAt(vertical.data, 96, 170), background) > 80, 'vertical trail must extend down')

    const angled = await renderMode(sourcePath, maskPath, 'right', 60, 'right-angle-60')
    assert.ok(colorDistance(rgbaAt(right.data, 170, 125), background) > 80, 'flat paper strip keeps its full projected width')
    assert.ok(colorDistance(rgbaAt(angled.data, 170, 125), background) < 8, 'axial rotation foreshortens the paper strip')

    const narrow = await renderMode(sourcePath, maskPath, 'right', 0, 'right-size-50', 50)
    assert.ok(colorDistance(rgbaAt(narrow.data, 170, 125), background) < 8, 'ribbon size controls the paper strip cross-section')
    console.log(`pixel stretch render tests passed; outputs: ${outputRoot}`)
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
