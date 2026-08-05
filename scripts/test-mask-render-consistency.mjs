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
    glowStrength: 0, glowRadius: 35, glowThreshold: 65,
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

function writeSkinTexturePpmPixels() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const texture = ((x * 13 + y * 7) % 5 - 2) * 4
      pixels[offset] = 158 + texture
      pixels[offset + 1] = 116 + texture
      pixels[offset + 2] = 102 + texture
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
}

function writeToneGlowPpmPixels() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const highlight = x >= 21 && x < 27 && y >= 13 && y < 19
      const black = x < 8
      const value = highlight ? 255 : black ? 0 : 96
      pixels[offset] = value
      pixels[offset + 1] = highlight ? 236 : value
      pixels[offset + 2] = highlight ? 196 : value
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
}

function writeBlueSkyPpmPixels() {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const alternate = (x + y) % 2 === 0
      pixels[offset] = alternate ? 100 : 98
      pixels[offset + 1] = alternate ? 98 : 102
      pixels[offset + 2] = 180
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels])
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
    maskTrack: options.maskTrack,
    maskTimeline: options.maskTimeline,
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

function pixelBrightnessAt(frame, x, y) {
  const index = (y * width + x) * 4
  return frame[index] + frame[index + 1] + frame[index + 2]
}

function horizontalPixelDelta(frame, x, y) {
  const first = (y * width + x) * 4
  const second = first + 4
  return Math.abs(frame[first] - frame[second])
    + Math.abs(frame[first + 1] - frame[second + 1])
    + Math.abs(frame[first + 2] - frame[second + 2])
}

function changedPixelCentroid(base, adjusted) {
  let weight = 0
  let weightedX = 0
  let weightedY = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const delta = pixelDeltaAt(base, adjusted, x, y)
      weight += delta
      weightedX += delta * x
      weightedY += delta * y
    }
  }
  return { x: weightedX / weight, y: weightedY / weight }
}

function fixedMaskTrack(transform) {
  return {
    version: 1,
    anchorTime: 0,
    startTime: 0,
    endTime: 0,
    keyframes: [{
      time: 0,
      translateX: 0,
      translateY: 0,
      scale: 1,
      rotation: 0,
      confidence: 1,
      ...transform,
    }],
  }
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
  const skinTextureSourcePath = path.join(temporaryRoot, 'skin-texture.ppm')
  const toneGlowSourcePath = path.join(temporaryRoot, 'tone-glow.ppm')
  const blueSkySourcePath = path.join(temporaryRoot, 'blue-sky.ppm')
  const invalidWatermarkPath = path.join(temporaryRoot, 'invalid-watermark.png')
  const rectMaskPath = path.join(temporaryRoot, 'rect.pgm')
  const leftMaskPath = path.join(temporaryRoot, 'left.pgm')
  const fullMaskPath = path.join(temporaryRoot, 'full.pgm')
  await Promise.all([
    writeFile(sourcePath, writePpmPixels()),
    writeFile(uniformSourcePath, writeUniformPpmPixels()),
    writeFile(skinTextureSourcePath, writeSkinTexturePpmPixels()),
    writeFile(toneGlowSourcePath, writeToneGlowPpmPixels()),
    writeFile(blueSkySourcePath, writeBlueSkyPpmPixels()),
    writeFile(invalidWatermarkPath, Buffer.alloc(0)),
    writeFile(rectMaskPath, maskPixels('rect')),
    writeFile(leftMaskPath, maskPixels('left')),
    writeFile(fullMaskPath, maskPixels('full')),
  ])

  native.initCompositor()
  const base = await renderAndMatchExport('base', composition([mediaLayer(sourcePath)]))
  const invalidWatermark = await renderAndMatchExport('invalid-watermark', composition([
    mediaLayer(sourcePath),
    {
      ...mediaLayer(invalidWatermarkPath),
      id: 'watermark', zIndex: 1,
      positioning: { anchor: 'bottom-center', targetWidth: 0.23, marginX: 0.03, marginY: 0.03 },
    },
  ]))
  assert.equal(
    pixelDifference(base, invalidWatermark).total,
    0,
    'an unavailable watermark must be ignored without blanking the rendered media',
  )
  const toneBase = await renderAndMatchExport('tone-base', composition([mediaLayer(toneGlowSourcePath)]))
  const raisedBrightness = await renderAndMatchExport('raised-brightness', composition([{
    ...mediaLayer(toneGlowSourcePath), color: renderColor({ brightness: 100 }),
  }]))
  assert.equal(pixelBrightnessAt(raisedBrightness, 2, 16), 0, 'raising brightness must preserve pure black')
  assert.ok(pixelBrightnessAt(raisedBrightness, 12, 16) > pixelBrightnessAt(toneBase, 12, 16), 'raising brightness must lift midtones')
  const highlightIndex = (16 * width + 24) * 4
  assert.ok(
    Math.min(raisedBrightness[highlightIndex], raisedBrightness[highlightIndex + 1], raisedBrightness[highlightIndex + 2]) < 255,
    'raising brightness must preserve highlight color instead of clipping it to white',
  )
  const lowContrast = await renderAndMatchExport('low-contrast', composition([{
    ...mediaLayer(toneGlowSourcePath), color: renderColor({ contrast: -100 }),
  }]))
  assert.equal(pixelBrightnessAt(lowContrast, 2, 16), 0, 'negative contrast must preserve pure black')
  const raisedBlacks = await renderAndMatchExport('raised-blacks', composition([{
    ...mediaLayer(toneGlowSourcePath), color: renderColor({ blacks: 100 }),
  }]))
  assert.equal(pixelBrightnessAt(raisedBlacks, 2, 16), 0, 'raising black must not turn pure black gray')
  assert.ok(pixelBrightnessAt(raisedBlacks, 12, 16) < pixelBrightnessAt(toneBase, 12, 16), 'raising black must deepen shadow tones')
  const glow = await renderAndMatchExport('glow', composition([{
    ...mediaLayer(toneGlowSourcePath), color: renderColor({ glowStrength: 80, glowRadius: 65, glowThreshold: 70 }),
  }]))
  assert.ok(pixelBrightnessAt(glow, 18, 16) > pixelBrightnessAt(toneBase, 18, 16), 'glow must spread highlights into nearby pixels')
  const blueSkyBase = await renderAndMatchExport('blue-sky-base', composition([mediaLayer(blueSkySourcePath)]))
  const blueSaturationChannels = renderColor().hslChannels.map((channel) => (
    channel.hue === 240 ? { ...channel, hueShift: 120, saturation: 100 } : channel
  ))
  const saturatedBlue = await renderAndMatchExport('hsl-blue-saturation', composition([{
    ...mediaLayer(blueSkySourcePath), color: renderColor({ hslChannels: blueSaturationChannels }),
  }]))
  const blueIndex = (16 * width + 24) * 4
  assert.ok(
    Math.min(saturatedBlue[blueIndex], saturatedBlue[blueIndex + 1], saturatedBlue[blueIndex + 2]) > 0,
    'positive HSL saturation must not force a selected channel into clipped color noise',
  )
  assert.ok(
    horizontalPixelDelta(saturatedBlue, 24, 16) <= Math.max(12, horizontalPixelDelta(blueSkyBase, 24, 16) * 2),
    'HSL hue shifts must not amplify subtle neighboring hue noise into color speckles',
  )
  const normal = await renderAndMatchExport('normal', composition([
    mediaLayer(sourcePath), localLayer(sourcePath, rectMaskPath),
  ]))
  assert.ok(pixelDifference(base, normal).changed > 150, 'normal mask must change the selected region')
  const timelineTransform = await renderAndMatchExport('timeline-transform', composition([
    mediaLayer(sourcePath),
    localLayer(sourcePath, rectMaskPath, {
      maskTimeline: {
        version: 1,
        startTime: 0,
        endTime: 1,
        sampleInterval: 0.125,
        frames: [{
          time: 0,
          path: rectMaskPath,
          transform: { translateX: 0.1, translateY: 0, scale: 1, rotation: 0, confidence: 0.9 },
        }],
      },
    }),
  ]))
  assert.ok(pixelDifference(normal, timelineTransform).changed > 0, 'timeline transform must move the selected region')
  const skinTextureBase = await renderAndMatchExport('skin-texture-base', composition([
    mediaLayer(skinTextureSourcePath),
  ]))
  const beautySmoothing = await renderAndMatchExport('beauty-smoothing', composition([
    mediaLayer(skinTextureSourcePath),
    localLayer(skinTextureSourcePath, fullMaskPath, { color: { denoise: 60 } }),
  ]))
  assert.ok(
    pixelDifference(skinTextureBase, beautySmoothing).total > 0,
    'beauty smoothing must execute the edge-aware denoise branch',
  )
  const beautyTexture = await renderAndMatchExport('beauty-texture', composition([
    mediaLayer(skinTextureSourcePath),
    localLayer(skinTextureSourcePath, fullMaskPath, { color: { texture: 50 } }),
  ]))
  assert.ok(
    pixelDifference(skinTextureBase, beautyTexture).total > 0,
    'beauty texture must restore local detail without requiring smoothing',
  )
  const manualBeautyRetouch = await renderAndMatchExport('beauty-manual-retouch', composition([
    mediaLayer(skinTextureSourcePath),
    localLayer(skinTextureSourcePath, rectMaskPath, { color: { denoise: 1900 } }),
  ]))
  assert.ok(
    pixelDifference(skinTextureBase, manualBeautyRetouch).total > 0,
    'manual beauty retouch must replace texture inside the painted mask',
  )
  assert.ok(pixelDeltaAt(skinTextureBase, manualBeautyRetouch, 15, 14) > 0, 'manual beauty retouch must affect the painted center')
  assert.equal(pixelDeltaAt(skinTextureBase, manualBeautyRetouch, 2, 2), 0, 'manual beauty retouch must preserve pixels outside the mask')
  const precomposeGroup = 'mask-color-source'
  const precomposedClear = await renderAndMatchExport('precomposed-clear', composition([
    { ...mediaLayer(sourcePath), precomposeGroup, precomposeRole: 'input' },
    { ...localLayer(sourcePath, rectMaskPath), precomposeGroup, precomposeRole: 'input' },
    { ...mediaLayer(sourcePath), precomposeGroup, precomposeRole: 'output' },
  ]))
  const precomposedDifference = pixelDifference(normal, precomposedClear)
  assert.ok(
    precomposedDifference.max <= 3,
    `clear precomposition must preserve the flattened mask color, max delta ${precomposedDifference.max}`,
  )
  const precomposedBlur = await renderAndMatchExport('precomposed-blur', composition([
    { ...mediaLayer(sourcePath), precomposeGroup, precomposeRole: 'input' },
    { ...localLayer(sourcePath, rectMaskPath), precomposeGroup, precomposeRole: 'input' },
    {
      ...mediaLayer(sourcePath),
      precomposeGroup,
      precomposeRole: 'output',
      color: renderColor({ denoise: 3100 }),
    },
  ]))
  assert.ok(
    pixelDifference(precomposedClear, precomposedBlur).changed > width * height * 0.5,
    'blur must run on the fully flattened mask color texture',
  )

  const translated = await renderAndMatchExport('tracked-translation', composition([
    mediaLayer(sourcePath),
    localLayer(sourcePath, rectMaskPath, { maskTrack: fixedMaskTrack({ translateX: 0.25 }) }),
  ]))
  const normalCentroid = changedPixelCentroid(base, normal)
  const translatedCentroid = changedPixelCentroid(base, translated)
  assert.ok(translatedCentroid.x > normalCentroid.x + width * 0.18, 'positive track translation must move only the mask effect to the right')
  assert.ok(pixelDifference(base, translated).changed < width * height * 0.5, 'track translation must not transform the source image')

  const scaledRotated = await renderAndMatchExport('tracked-scale-rotation', composition([
    mediaLayer(sourcePath),
    localLayer(sourcePath, rectMaskPath, { maskTrack: fixedMaskTrack({ scale: 1.35, rotation: 0.35 }) }),
  ]))
  assert.ok(pixelDifference(normal, scaledRotated).changed > 50, 'track scale and rotation must transform the mask effect')

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
