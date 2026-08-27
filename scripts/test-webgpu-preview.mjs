#!/usr/bin/env node
/* global Buffer */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import net from 'node:net'
import { promisify } from 'node:util'

import { chromium } from '@playwright/test'
import { createServer } from 'vite'

import { buildCompositionFromPreviewLayers } from '../src/components/renderComposition.ts'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const nativePath = path.join(projectRoot, 'luna-render-core', 'luna-render-core.node')
const native = require(nativePath)
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path

const ORIGINAL_IMAGE_PATH = '/Users/zhouchao/照片同步/lunaultra/2026-08-09/IMG_20260809_184536_331.jpg'
const inputPath = path.resolve(process.env.LUNA_WEBGPU_COMPARISON_IMAGE ?? process.argv[2] ?? ORIGINAL_IMAGE_PATH)
const LUT_PATH = path.join(projectRoot, 'public', 'luts', '徕卡', 'Leica Classic.cube')
const WATERMARK_PATH = path.join(projectRoot, 'src', 'assets', 'watermark', 'ic_watermark_luna_ultra_image_cn.png')
const FONT_PATH = path.join(projectRoot, 'public', 'fonts', 'SourceHanSansSC-Regular.otf')
const canvasMaxSide = 960
const runRoot = await mkdtemp(path.join(tmpdir(), 'luna-webgpu-direct-comparison-'))
const outputRoot = path.resolve(process.env.LUNA_WEBGPU_COMPARISON_OUTPUT_DIR ?? runRoot)
const lowResImagePath = path.join(runRoot, 'photo-960.jpg')
const maskPath = path.join(runRoot, 'comparison-mask.pgm')
const FEATURES = ['baseline', 'mask', 'lut', 'subtitle', 'watermark', 'border', 'creative']

function renderColor(overrides = {}) {
  return {
    exposure: 0.18, black: 0, brightness: 6, contrast: 8, saturation: 7, vibrance: 9,
    temperature: 4, tint: -2, highlights: -6, shadows: 8, whites: 0, blacks: 0,
    clarity: 0, texture: 0, sharpen: 0, denoise: 0, skinSmoothing: 0, glowStrength: 0,
    glowRadius: 35, glowThreshold: 65, gradeShadowsHue: 220, gradeShadowsAmount: 0,
    gradeMidHue: 35, gradeMidAmount: 0, gradeHighlightsHue: 42, gradeHighlightsAmount: 0,
    curveLift: 0, curveContrast: 0,
    curve: { rgb: [], luminance: [], red: [], green: [], blue: [] },
    levelsBlack: 0, levelsGray: 0.5, levelsWhite: 1,
    hslChannels: [0, 30, 60, 120, 180, 240, 285, 320].map((hue) => ({
      hue, hueShift: 0, saturation: 0, luminance: 0,
    })),
    ...overrides,
  }
}

function transform() {
  return { orientation: 0, rotate: 0, flipH: false, flipV: false, scale: 1, translateX: 0, translateY: 0 }
}

function mediaLayer(filePath, overrides = {}) {
  return {
    layerType: 'media', filePath, isVideo: false, videoTime: 0, fit: 'cover',
    dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1, zIndex: 0, color: renderColor(), transform: transform(), ...overrides,
  }
}

function shapeLayer(overrides = {}) {
  return {
    layerType: 'shape', filePath: '', isVideo: false, fit: 'stretch',
    dstX: 0, dstY: 0, dstW: 1, dstH: 1, srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1, zIndex: 1, color: renderColor(), transform: transform(),
    shape: 'rectangle', fillColor: '#F7F6F2', ...overrides,
  }
}

function textLayer(overrides = {}) {
  return {
    layerType: 'text', filePath: '', isVideo: false, fit: 'stretch',
    dstX: 0.2, dstY: 0.82, dstW: 0.6, dstH: 0.09, srcX: 0, srcY: 0, srcW: 1, srcH: 1,
    opacity: 1, zIndex: 2, color: renderColor(), transform: transform(), content: 'Luna WebGPU 中文',
    fontSize: 42, fontFamily: 'Source Han Sans SC', fontFile: FONT_PATH, fontWeight: 400, textColor: '#FFFFFF',
    textAlign: 'center', verticalAlign: 'middle', ...overrides,
  }
}

function creativeLayers(sourcePath) {
  return [
    mediaLayer(sourcePath, { color: renderColor({ saturation: -76, contrast: -10, shadows: 18, blacks: 18 }) }),
    mediaLayer(sourcePath, {
      zIndex: 1,
      reveal: { direction: 'left-to-right', start: 0.05, duration: 0.9, easing: 'linear' },
    }),
  ]
}

function featureLayers(sourcePath, feature, resources) {
  const base = mediaLayer(sourcePath)
  if (feature === 'baseline') return [base]
  if (feature === 'mask') {
    return [base, mediaLayer(sourcePath, {
      layerType: 'local-color', zIndex: 1, maskPath: resources.maskPath, maskProjectId: 'comparison-mask-project', maskOpacity: 0.82,
      maskFeather: 8, blendMode: 'screen',
      color: renderColor({ brightness: 4, saturation: 18, vibrance: 12, temperature: -8 }),
    })]
  }
  if (feature === 'lut') return [mediaLayer(sourcePath, { lutId: resources.lutPath, lutIntensity: 62 })]
  if (feature === 'subtitle') {
    return [base,
      shapeLayer({ dstX: 0.28, dstY: 0.79, dstW: 0.44, dstH: 0.1, zIndex: 900,
        shape: 'rounded-rectangle', fillColor: '#101820B8', cornerRadius: 0.12,
        strokeColor: '#73C7FF', strokeWidth: 2, activeStart: 0, activeEnd: 5 }),
      textLayer({ dstX: 0.28, dstY: 0.79, dstW: 0.44, dstH: 0.1, zIndex: 901, activeStart: 0, activeEnd: 5 }),
    ]
  }
  if (feature === 'watermark') {
    return [base, mediaLayer(resources.watermarkPath, {
      zIndex: 10, dstX: 0.72, dstY: 0.9, dstW: 0.24, dstH: 0.04,
      positioning: { anchor: 'bottom-right', targetWidth: 0.24, marginX: 0.03, marginY: 0.03 },
      color: renderColor({ exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 }),
      opacity: 0.86,
    })]
  }
  if (feature === 'border') {
    return [base,
      shapeLayer({ dstY: 0, dstH: 0.07, zIndex: 20 }),
      shapeLayer({ dstY: 0.93, dstH: 0.07, zIndex: 20 }),
      shapeLayer({ dstX: 0, dstY: 0.07, dstW: 0.045, dstH: 0.86, zIndex: 20 }),
      shapeLayer({ dstX: 0.955, dstY: 0.07, dstW: 0.045, dstH: 0.86, zIndex: 20 }),
      textLayer({ dstX: 0.06, dstY: 0.945, dstW: 0.4, dstH: 0.04, zIndex: 21, content: 'LUNA ULTRA | 2026', fontSize: 18, textColor: '#444444' }),
    ]
  }
  return creativeLayers(sourcePath)
}

function makeMask(width = 160, height = 90) {
  const bytes = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const dx = (x / width - 0.31) / 0.22
    const dy = (y / height - 0.42) / 0.34
    bytes[y * width + x] = Math.round(Math.max(0, Math.min(1, 1.12 - Math.hypot(dx, dy))) * 255)
  }
  return { width, height, bytes }
}

async function createLowResolutionImage() {
  await execFileAsync(ffmpegPath, ['-y', '-v', 'error', '-i', inputPath,
    '-vf', `scale=${canvasMaxSide}:${canvasMaxSide}:force_original_aspect_ratio=decrease`,
    '-frames:v', '1', '-q:v', '3', lowResImagePath])
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', lowResImagePath,
  ])
  const stream = JSON.parse(stdout).streams?.[0]
  assert.ok(stream?.width && stream?.height, '低分辨率照片尺寸读取失败')
  return { width: stream.width, height: stream.height }
}

async function encodePng(raw, width, height, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', outputPath])
    const errors = []
    child.stderr.on('data', (chunk) => errors.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(Buffer.concat(errors).toString('utf8') || `ffmpeg exited with ${code}`)))
    child.stdin.end(raw)
  })
}

async function pngToRgba(pngPath, width, height) {
  const { stdout } = await execFileAsync(ffmpegPath, ['-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-frames:v', '1', 'pipe:1'], { encoding: 'buffer', maxBuffer: width * height * 8 })
  return Buffer.from(stdout)
}

function pixelStats(data) {
  let red = 0; let green = 0; let blue = 0; let alpha = 0; let nonTransparentPixels = 0
  const pixels = Math.floor(data.length / 4)
  for (let index = 0; index < data.length; index += 4) {
    red += data[index] ?? 0; green += data[index + 1] ?? 0; blue += data[index + 2] ?? 0; alpha += data[index + 3] ?? 0
    if ((data[index + 3] ?? 0) > 8) nonTransparentPixels += 1
  }
  return { pixels, nonTransparentPixels, meanRgb: pixels ? [red / pixels, green / pixels, blue / pixels] : [0, 0, 0], meanAlpha: pixels ? alpha / pixels : 0 }
}

function comparePixels(nativeData, webgpuData) {
  const length = Math.min(nativeData.length, webgpuData.length)
  let sum = 0; let max = 0; let differentPixels = 0
  for (let index = 0; index < length; index += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((nativeData[index + channel] ?? 0) - (webgpuData[index + channel] ?? 0))
      sum += delta; max = Math.max(max, delta)
    }
    if ([0, 1, 2].some((channel) => Math.abs((nativeData[index + channel] ?? 0) - (webgpuData[index + channel] ?? 0)) > 2)) differentPixels += 1
  }
  return { sameSize: nativeData.length === webgpuData.length, meanAbsDelta: sum / Math.max(1, length), maxAbsDelta: max, differentPixelRatio: differentPixels / Math.max(1, Math.floor(length / 4)) }
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function runNative(features, width, height) {
  native.initCompositor(path.join(outputRoot, 'rust-comparison.log'))
  const measurements = []
  try {
    for (const feature of features) {
      const startedAt = performance.now()
      const composition = buildCompositionFromPreviewLayers(feature.layers, width, height)
      const result = native.renderCompositionFrame({
        ffmpegPath,
        ffprobePath,
        // N-API's nested optional objects require absent fields, not explicit undefined values.
        composition: JSON.parse(JSON.stringify(composition)),
        time: feature.time,
        maxSide: canvasMaxSide,
      })
      const raw = Buffer.from(result.data)
      const outputPath = path.join(outputRoot, `${feature.id}-rust-wgpu.png`)
      await encodePng(raw, result.width, result.height, outputPath)
      measurements.push({ feature: feature.id, renderer: 'rust-wgpu', elapsedMs: Math.round(performance.now() - startedAt), width: result.width, height: result.height, outputPath, bytes: raw.length, pixelStats: pixelStats(raw), raw })
    }
  } finally {
    // The current N-API build keeps the compositor process-local and releases it on exit.
  }
  return measurements
}

async function runWebGpu(features, browserFeatures, width, height) {
  const port = await reservePort()
  // This is a standalone Vite page. Never load the app config: it contains the Electron plugin.
  const vite = await createServer({ configFile: false, root: projectRoot, clearScreen: false, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true } })
  await vite.listen()
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--force-device-scale-factor=1'] })
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const runtimeErrors = []
  const runtimeWarnings = []
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`) })
  page.on('console', (message) => {
    if (message.type() === 'warning') {
      runtimeWarnings.push(`console: ${message.text()}`)
      console.warn(`[standalone warning] ${message.text()}`)
    }
  })
  const measurements = []
  try {
    await page.goto(`http://127.0.0.1:${port}/webgpu-comparison.html`, { waitUntil: 'domcontentloaded' })
    const initialized = await page.evaluate((next) => window.lunaWebGpuComparison?.initialize(next), {
      canvasWidth: width, canvasHeight: height, maxSide: canvasMaxSide, lutText: browserFeatures.lutText,
      fontPath: browserFeatures.fontPath, fontData: browserFeatures.fontData,
      mask: browserFeatures.mask, features: browserFeatures.features,
    })
    assert.equal(initialized?.navigatorGpu, true, '当前 Chromium 没有可用的 WebGPU')
    for (const feature of features) {
      const startedAt = performance.now()
      const state = await page.evaluate((id) => window.lunaWebGpuComparison?.renderFeature(id), feature.id)
      const outputPath = path.join(outputRoot, `${feature.id}-webgpu.png`)
      await page.locator('#comparison-canvas').screenshot({ path: outputPath })
      const info = await stat(outputPath)
      const raw = await pngToRgba(outputPath, width, height)
      measurements.push({ feature: feature.id, renderer: 'webgpu', elapsedMs: Math.round(performance.now() - startedAt), browserRenderMs: state?.elapsedMs ?? null, layerCount: state?.layerCount ?? null, width, height, outputPath, bytes: info.size, pixelStats: pixelStats(raw), raw })
    }
  } finally {
    await page.evaluate(() => window.lunaWebGpuComparison?.destroy()).catch(() => undefined)
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
    await vite.close().catch(() => undefined)
  }
  return { measurements, runtimeErrors, runtimeWarnings }
}

await mkdir(outputRoot, { recursive: true })
const sourceStat = await stat(inputPath).catch(() => null)
assert.ok(sourceStat?.isFile(), `照片不存在: ${inputPath}`)
assert.ok((await stat(LUT_PATH)).isFile(), `LUT 不存在: ${LUT_PATH}`)
assert.ok((await stat(WATERMARK_PATH)).isFile(), `水印素材不存在: ${WATERMARK_PATH}`)

const { width, height } = await createLowResolutionImage()
const mask = makeMask()
await writeFile(maskPath, Buffer.concat([Buffer.from(`P5\n${mask.width} ${mask.height}\n255\n`, 'ascii'), mask.bytes]))
const imageDataUrl = `data:image/jpeg;base64,${(await readFile(lowResImagePath)).toString('base64')}`
const watermarkDataUrl = `data:image/png;base64,${(await readFile(WATERMARK_PATH)).toString('base64')}`
const lutText = await readFile(LUT_PATH, 'utf8')
const fontData = (await readFile(FONT_PATH)).toString('base64')

const nativeFeatures = FEATURES.map((id) => ({ id, time: id === 'creative' ? 0.5 : 0, layers: featureLayers(lowResImagePath, id, { maskPath, lutPath: LUT_PATH, watermarkPath: WATERMARK_PATH }) }))
const browserFeatures = FEATURES.map((id) => ({ id, time: id === 'creative' ? 0.5 : 0, layers: featureLayers(imageDataUrl, id, { maskPath: 'fixture://mask', lutPath: 'fixture://lut', watermarkPath: watermarkDataUrl }) }))

const nativeMeasurements = await runNative(nativeFeatures, width, height)
const webgpuResult = await runWebGpu(nativeFeatures, {
  features: browserFeatures, lutText, fontPath: FONT_PATH, fontData,
  mask: { width: mask.width, height: mask.height, bytes: [...mask.bytes] },
}, width, height)
const comparisons = FEATURES.map((feature) => {
  const rust = nativeMeasurements.find((entry) => entry.feature === feature)
  const webgpu = webgpuResult.measurements.find((entry) => entry.feature === feature)
  assert.ok(rust && webgpu, `缺少 ${feature} 对照结果`)
  return { feature, rustMs: rust.elapsedMs, webgpuMs: webgpu.browserRenderMs, rustOutput: rust.outputPath, webgpuOutput: webgpu.outputPath, rustPixels: rust.pixelStats, webgpuPixels: webgpu.pixelStats, pixelComparison: comparePixels(rust.raw, webgpu.raw) }
})

const report = {
  generatedAt: new Date().toISOString(), mode: 'standalone-rust-vs-webgpu',
  source: { original: inputPath, normalized: lowResImagePath, width, height, maxSide: canvasMaxSide },
  resourcePolicy: { oneImage: true, maxSide: canvasMaxSide, videos: false, ai: false, electron: false, chromiumPages: 1 },
  comparisons, runtimeErrors: webgpuResult.runtimeErrors, runtimeWarnings: webgpuResult.runtimeWarnings, outputRoot,
}
const reportPath = path.join(outputRoot, 'report.json')
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
const printableNative = nativeMeasurements.map((measurement) => {
  const { raw, ...printable } = measurement
  void raw
  return printable
})
const printableWebGpu = webgpuResult.measurements.map((measurement) => {
  const { raw, ...printable } = measurement
  void raw
  return printable
})
console.log(JSON.stringify({ ...report, nativeMeasurements: printableNative, webgpuMeasurements: printableWebGpu, reportPath }, null, 2))
assert.deepEqual(webgpuResult.runtimeErrors, [])
assert.deepEqual(webgpuResult.runtimeWarnings, [])
assert.ok(comparisons.every((entry) => (
  entry.rustPixels.nonTransparentPixels > 0
  && entry.webgpuPixels.nonTransparentPixels > 0
  && entry.webgpuPixels.meanRgb.some((channel) => channel > 2)
)))
