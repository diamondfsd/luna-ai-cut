import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const native = require(path.join(projectRoot, 'luna-render-core/luna-render-core.node'))
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-mask-render-'))
const width = 48
const height = 32

function renderColor(overrides = {}) {
  return {
    exposure: 0, black: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0,
    temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    clarity: 0, texture: 0, sharpen: 0, denoise: 0,
    gradeShadowsHue: 220, gradeShadowsAmount: 0, gradeMidHue: 35, gradeMidAmount: 0,
    gradeHighlightsHue: 42, gradeHighlightsAmount: 0, curveLift: 0, curveContrast: 0,
    curve: { rgb: [], luminance: [], red: [], green: [], blue: [] },
    levelsBlack: 0, levelsGray: 0.5, levelsWhite: 1,
    hslChannels: [0, 30, 60, 120, 180, 240, 285, 320].map((hue) => ({ hue, hueShift: 0, saturation: 0, luminance: 0 })),
    ...overrides,
  }
}

function writePpmPixels() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      pixels[offset] = 48 + Math.round(x / (width - 1) * 128)
      pixels[offset + 1] = 56 + Math.round(y / (height - 1) * 112)
      pixels[offset + 2] = (x < width / 2) === (y < height / 2) ? 72 : 184
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
}

function writeUniformPpmPixels(value = 72) {
  return Buffer.concat([
    Buffer.from(`P6\n${width} ${height}\n255\n`),
    Buffer.alloc(width * height * 3, value),
  ])
}

function maskPixels(kind) {
  const pixels = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const selected = kind === 'full'
        || (kind === 'left' && x < width / 2)
        || (kind === 'rect' && x >= 8 && x < 22 && y >= 6 && y < 23)
      pixels[y * width + x] = selected ? 255 : 0
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels])
}

function mediaLayer(sourcePath, transform = {}) {
  return {
    id: 'base', layerType: 'media', source: { path: sourcePath, sourceType: 'image' },
    rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', opacity: 1, zIndex: 0,
    transform: { orientation: 0, rotate: 0, flipH: false, flipV: false, scale: 1, ...transform },
  }
}

function localLayer(sourcePath, maskPath, options = {}) {
  return {
    ...mediaLayer(sourcePath, options.transform),
    id: options.id ?? 'local', layerType: 'local-color', zIndex: options.zIndex ?? 1,
    blendMode: options.blendMode ?? 'normal',
    color: renderColor(options.color ?? { exposure: -0.75, temperature: 12, saturation: 18 }),
    maskPath, maskOpacity: options.opacity ?? 1, maskInverted: options.inverted ?? false,
    maskFeather: options.feather ?? 0,
  }
}

function composition(layers) {
  return { version: 1, canvas: { width, height }, layers }
}

function pixelDifference(first, second) {
  assert.equal(first.length, second.length)
  let total = 0
  let changed = 0
  let max = 0
  for (let index = 0; index < first.length; index += 4) {
    const delta = Math.abs(first[index] - second[index])
      + Math.abs(first[index + 1] - second[index + 1])
      + Math.abs(first[index + 2] - second[index + 2])
    total += delta
    if (delta > 3) changed += 1
    max = Math.max(max, delta)
  }
  return { total, changed, max }
}

function pixelDeltaAt(first, second, x, y) {
  const index = (y * width + x) * 4
  return Math.abs(first[index] - second[index])
    + Math.abs(first[index + 1] - second[index + 1])
    + Math.abs(first[index + 2] - second[index + 2])
}

async function decodeRgba(filePath) {
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-i', filePath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-frames:v', '1', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: width * height * 8 })
  return Buffer.from(stdout)
}

let sampleIndex = 0
async function renderAndMatchExport(name, input) {
  const preview = native.renderCompositionFrame({
    ffmpegPath, ffprobePath, composition: input, time: 0, maxSide: Math.max(width, height),
  })
  assert.equal(preview.width, width, `${name}: preview width`)
  assert.equal(preview.height, height, `${name}: preview height`)
  const outputPath = path.join(temporaryRoot, `${String(sampleIndex++).padStart(2, '0')}-${name}.png`)
  await native.exportCompositionImageAsync({
    ffmpegPath, ffprobePath, outputPath, composition: input, format: 'png', quality: 100,
  })
  const exported = await decodeRgba(outputPath)
  const difference = pixelDifference(Buffer.from(preview.data), exported)
  assert.equal(difference.total, 0, `${name}: PNG export must match preview pixels exactly`)
  return Buffer.from(preview.data)
}

try {
  const sourcePath = path.join(temporaryRoot, 'asymmetric.ppm')
  const uniformSourcePath = path.join(temporaryRoot, 'uniform.ppm')
  const rectMaskPath = path.join(temporaryRoot, 'rect.pgm')
  const leftMaskPath = path.join(temporaryRoot, 'left.pgm')
  const fullMaskPath = path.join(temporaryRoot, 'full.pgm')
  await Promise.all([
    writeFile(sourcePath, writePpmPixels()),
    writeFile(uniformSourcePath, writeUniformPpmPixels()),
    writeFile(rectMaskPath, maskPixels('rect')),
    writeFile(leftMaskPath, maskPixels('left')),
    writeFile(fullMaskPath, maskPixels('full')),
  ])

  native.initCompositor()
  const base = await renderAndMatchExport('base', composition([mediaLayer(sourcePath)]))
  const normal = await renderAndMatchExport('normal', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, rectMaskPath),
  ]))
  assert.ok(pixelDifference(base, normal).changed > 150, 'normal mask must change the selected region')

  const opacityZero = await renderAndMatchExport('opacity-zero', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, rectMaskPath, { opacity: 0 }),
  ]))
  assert.equal(pixelDifference(base, opacityZero).total, 0, 'zero mask opacity must preserve the base image')
  const opacityHalf = await renderAndMatchExport('opacity-half', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, rectMaskPath, { opacity: 0.5 }),
  ]))
  const fullDelta = pixelDifference(base, normal).total
  const halfDelta = pixelDifference(base, opacityHalf).total
  assert.ok(halfDelta > fullDelta * 0.35 && halfDelta < fullDelta * 0.65, 'half opacity must produce a proportional local adjustment')

  const left = await renderAndMatchExport('left', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, leftMaskPath),
  ]))
  const inverted = await renderAndMatchExport('inverted', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, leftMaskPath, { inverted: true }),
  ]))
  assert.ok(pixelDifference(left, inverted).changed > width * height * 0.8, 'inversion must swap the selected half')

  const feathered = await renderAndMatchExport('feather', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, leftMaskPath, { feather: 8 }),
  ]))
  assert.ok(pixelDifference(left, feathered).changed > height * 4, 'feathering must soften pixels around the mask boundary')

  const uniformBase = await renderAndMatchExport('uniform-base', composition([mediaLayer(uniformSourcePath)]))
  const highExposureFeather = await renderAndMatchExport('high-exposure-feather', composition([
    mediaLayer(uniformSourcePath),
    localLayer(uniformSourcePath, leftMaskPath, { feather: 8, color: { exposure: 2 } }),
  ]))
  const outwardDeltas = Array.from(
    { length: 9 },
    (_, offset) => pixelDeltaAt(uniformBase, highExposureFeather, width / 2 - 1 + offset, height / 2),
  )
  assert.ok(outwardDeltas[0] > outwardDeltas[1], 'feather must begin fading immediately outside the hard edge')
  for (let index = 1; index < outwardDeltas.length; index += 1) {
    assert.ok(
      outwardDeltas[index] <= outwardDeltas[index - 1],
      `high-exposure feather must decay monotonically, got ${outwardDeltas.join(', ')}`,
    )
  }
  assert.equal(outwardDeltas.at(-1), 0, 'feather must reach zero at the configured outer radius')

  const blendOutputs = new Map()
  for (const blendMode of ['normal', 'multiply', 'screen', 'add']) {
    const output = await renderAndMatchExport(`blend-${blendMode}`, composition([
      mediaLayer(sourcePath), localLayer(sourcePath, rectMaskPath, { blendMode }),
    ]))
    blendOutputs.set(blendMode, output)
  }
  for (const blendMode of ['multiply', 'screen', 'add']) {
    assert.ok(pixelDifference(blendOutputs.get('normal'), blendOutputs.get(blendMode)).changed > 100, `${blendMode} must differ from normal blending`)
  }

  const geometryCases = [
    ['crop', { crop: { x: 0.15, y: 0.1, w: 0.7, h: 0.75 } }],
    ['rotate-90', { orientation: 90 }],
    ['rotate-180', { orientation: 180 }],
    ['rotate-270', { orientation: 270 }],
    ['flip-horizontal', { flipH: true }],
    ['flip-vertical', { flipV: true }],
    ['crop-rotate-flip-border', { crop: { x: 0.1, y: 0.05, w: 0.8, h: 0.85 }, orientation: 90, flipH: true }],
  ]
  for (const [name, transform] of geometryCases) {
    const rect = name.includes('border') ? { x: 0.12, y: 0.12, w: 0.76, h: 0.76 } : { x: 0, y: 0, w: 1, h: 1 }
    const transformedBase = await renderAndMatchExport(`${name}-base`, composition([{ ...mediaLayer(sourcePath, transform), rect }]))
    const transformedMask = await renderAndMatchExport(`${name}-mask`, composition([
      { ...mediaLayer(sourcePath, transform), rect },
      { ...localLayer(sourcePath, rectMaskPath, { transform }), rect },
    ]))
    assert.ok(pixelDifference(transformedBase, transformedMask).changed > 30, `${name}: transformed mask must remain active and aligned`)
  }

  const topOnly = await renderAndMatchExport('top-only', composition([
    mediaLayer(sourcePath),
    localLayer(sourcePath, fullMaskPath, { id: 'top', zIndex: 2, color: { exposure: 0.4, temperature: -20 } }),
  ]))
  const stacked = await renderAndMatchExport('stacked', composition([
    mediaLayer(sourcePath),
    localLayer(sourcePath, fullMaskPath, { id: 'bottom', zIndex: 1, color: { exposure: -1 } }),
    localLayer(sourcePath, fullMaskPath, { id: 'top', zIndex: 2, color: { exposure: 0.4, temperature: -20 } }),
  ]))
  assert.equal(pixelDifference(topOnly, stacked).total, 0, 'the visual top normal layer must render last')

  const fiveLayerComposition = composition([
    mediaLayer(sourcePath),
    localLayer(sourcePath, fullMaskPath, { id: 'layer-5', zIndex: 1, opacity: 0.25, blendMode: 'multiply', color: { exposure: -0.2 } }),
    localLayer(sourcePath, leftMaskPath, { id: 'layer-4', zIndex: 2, opacity: 0.4, blendMode: 'screen', color: { temperature: 18 } }),
    localLayer(sourcePath, rectMaskPath, { id: 'layer-3', zIndex: 3, opacity: 0.55, blendMode: 'add', color: { saturation: 24 } }),
    localLayer(sourcePath, leftMaskPath, { id: 'layer-2', zIndex: 4, opacity: 0.7, inverted: true, feather: 4, color: { exposure: 0.15 } }),
    localLayer(sourcePath, rectMaskPath, { id: 'layer-1', zIndex: 5, opacity: 0.85, feather: 2, color: { temperature: -12, saturation: -10 } }),
  ])
  const fiveLayerFirst = await renderAndMatchExport('five-layers-first', fiveLayerComposition)
  const fiveLayerSecond = await renderAndMatchExport('five-layers-second', fiveLayerComposition)
  assert.equal(pixelDifference(fiveLayerFirst, fiveLayerSecond).total, 0, 'five-layer rendering must be deterministic')

  console.log(`mask render consistency tests passed (${sampleIndex} preview/export pairs)`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
