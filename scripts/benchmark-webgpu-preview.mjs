#!/usr/bin/env node
/* global Buffer */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import net from 'node:net'
import { promisify } from 'node:util'

import { chromium } from '@playwright/test'
import { createServer as createViteServer } from 'vite'

import { buildCompositionFromPreviewLayers } from '../src/components/renderComposition.ts'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const projectRoot = path.resolve(import.meta.dirname, '..')
const nativePath = path.join(projectRoot, 'luna-render-core', 'luna-render-core.node')
const SKIP_NATIVE = process.env.LUNA_WEBGPU_BENCHMARK_SKIP_NATIVE === '1'
const SKIP_WEBGPU = process.env.LUNA_WEBGPU_BENCHMARK_SKIP_WEBGPU === '1'
const native = SKIP_NATIVE ? null : require(nativePath)
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path

const DEFAULT_VIDEO_PATH = '/Users/zhouchao/照片同步/lunaultra/2026-06-20/VID_20260620_152505_045.mp4'
const inputPath = path.resolve(process.env.LUNA_WEBGPU_BENCHMARK_VIDEO ?? process.argv[2] ?? DEFAULT_VIDEO_PATH)
const LUT_PATH = path.join(projectRoot, 'public', 'luts', '徕卡', 'Leica Classic.cube')
const WATERMARK_PATH = path.join(projectRoot, 'src', 'assets', 'watermark', 'ic_watermark_luna_ultra_image_cn.png')
const FONT_PATH = path.join(projectRoot, 'public', 'fonts', 'SourceHanSansSC-Regular.otf')
const MAX_SIDE = Math.max(360, Number(process.env.LUNA_WEBGPU_BENCHMARK_MAX_SIDE ?? 720))
const TARGET_FPS = 30
const FRAME_COUNT = 24
const BENCHMARK_DURATION_MS = Math.round((FRAME_COUNT / TARGET_FPS) * 1000)
const USE_ORIGINAL_VIDEO = process.env.LUNA_WEBGPU_BENCHMARK_USE_ORIGINAL === '1'
const WAIT_FOR_GPU = process.env.LUNA_WEBGPU_BENCHMARK_WAIT_FOR_GPU === '1'
const BASELINE_ONLY = process.env.LUNA_WEBGPU_BENCHMARK_BASELINE_ONLY === '1'
const PRESENTATION_WIDTH = 960
const PRESENTATION_HEIGHT = 540

function round(value) {
  return Math.round(value * 100) / 100
}

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

function videoLayer(filePath, overrides = {}) {
  return {
    layerType: 'media', filePath, isVideo: true, videoSourceKey: 'benchmark-video', videoTime: 0,
    videoOffset: 0, videoDuration: FRAME_COUNT / TARGET_FPS, fit: 'cover',
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

function makeMask(width = 160, height = 90) {
  const bytes = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const dx = (x / width - 0.31) / 0.22
    const dy = (y / height - 0.42) / 0.34
    bytes[y * width + x] = Math.round(Math.max(0, Math.min(1, 1.12 - Math.hypot(dx, dy))) * 255)
  }
  return { width, height, bytes }
}

function fullStackLayers(sourcePath, resources) {
  const base = videoLayer(sourcePath, {
    layerType: 'local-color',
    maskPath: resources.maskPath,
    maskProjectId: 'benchmark-mask-project',
    maskOpacity: 0.82,
    maskFeather: 8,
    blendMode: 'screen',
    lutId: resources.lutPath,
    lutIntensity: 62,
  })
  return [
    base,
    videoLayer(sourcePath, {
      zIndex: 1,
      opacity: 0.34,
      color: renderColor({ saturation: -76, contrast: -10, shadows: 18, blacks: 18 }),
      reveal: { direction: 'left-to-right', start: 0.05, duration: 0.7, easing: 'linear' },
    }),
    shapeLayer({ dstX: 0.28, dstY: 0.79, dstW: 0.44, dstH: 0.1, zIndex: 900,
      shape: 'rounded-rectangle', fillColor: '#101820B8', cornerRadius: 0.12,
      strokeColor: '#73C7FF', strokeWidth: 2, activeStart: 0, activeEnd: 1 }),
    textLayer({ dstX: 0.28, dstY: 0.79, dstW: 0.44, dstH: 0.1, zIndex: 901, activeStart: 0, activeEnd: 1 }),
    {
      ...videoLayer(resources.watermarkPath, {
        layerType: 'media', isVideo: false, videoSourceKey: undefined, videoDuration: undefined,
        zIndex: 10, dstX: 0.72, dstY: 0.9, dstW: 0.24, dstH: 0.04,
        positioning: { anchor: 'bottom-right', targetWidth: 0.24, marginX: 0.03, marginY: 0.03 },
        color: renderColor({ exposure: 0, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0 }),
        opacity: 0.86,
      }),
    },
    shapeLayer({ dstY: 0, dstH: 0.07, zIndex: 20 }),
    shapeLayer({ dstY: 0.93, dstH: 0.07, zIndex: 20 }),
    shapeLayer({ dstX: 0, dstY: 0.07, dstW: 0.045, dstH: 0.86, zIndex: 20 }),
    shapeLayer({ dstX: 0.955, dstY: 0.07, dstW: 0.045, dstH: 0.86, zIndex: 20 }),
    textLayer({ dstX: 0.06, dstY: 0.945, dstW: 0.4, dstH: 0.04, zIndex: 21, content: 'LUNA ULTRA | 2026', fontSize: 18, textColor: '#444444' }),
  ]
}

async function probeVideo(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,avg_frame_rate,r_frame_rate,nb_frames,codec_name,pix_fmt',
    '-of', 'json', filePath,
  ])
  const stream = JSON.parse(stdout).streams?.[0]
  assert.ok(stream?.width && stream?.height && stream?.duration, '视频元数据读取失败')
  return stream
}

async function createBenchmarkVideo(inputFilePath, outputFilePath, width, height) {
  await execFileAsync(ffmpegPath, [
    '-y', '-v', 'error', '-i', inputFilePath,
    '-vf', `scale=${width}:${height}`,
    '-t', String((FRAME_COUNT + 4) / TARGET_FPS),
    '-r', String(TARGET_FPS), '-an',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', outputFilePath,
  ])
}

function parseRate(value) {
  if (typeof value !== 'string' || !value.includes('/')) return null
  const [numerator, denominator] = value.split('/').map(Number)
  return denominator > 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : null
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  const totalMs = samples.reduce((sum, value) => sum + value, 0)
  const percentile = (ratio) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] : null
  return {
    frames: samples.length,
    totalMs: round(totalMs),
    averageMs: samples.length ? round(totalMs / samples.length) : null,
    medianMs: percentile(0.5) == null ? null : round(percentile(0.5)),
    p95Ms: percentile(0.95) == null ? null : round(percentile(0.95)),
    minMs: sorted.length ? round(sorted[0]) : null,
    maxMs: sorted.length ? round(sorted[sorted.length - 1]) : null,
    effectiveFps: totalMs > 0 ? round(samples.length * 1000 / totalMs) : 0,
  }
}

function deltaQuality(before, after, key) {
  if (before[key] == null || after[key] == null) return null
  return after[key] - before[key]
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function inspectCanvas(page) {
  return page.locator('#comparison-canvas').evaluate(async (element) => {
    const canvas = element
    const width = canvas.width
    const height = canvas.height
    const capture = document.createElement('canvas')
    capture.width = width
    capture.height = height
    const context = capture.getContext('2d')
    if (!context) throw new Error('无法读取 WebGPU 画布画面')
    const snapshot = new Image()
    snapshot.src = canvas.toDataURL('image/png')
    await snapshot.decode()
    context.drawImage(snapshot, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height).data
    const coverage = (startX, startY, regionWidth, regionHeight) => {
      let visible = 0
      const total = regionWidth * regionHeight
      for (let y = startY; y < startY + regionHeight; y += 1) {
        for (let x = startX; x < startX + regionWidth; x += 1) {
          if ((pixels[(y * width + x) * 4 + 3] ?? 0) > 8) visible += 1
        }
      }
      return visible / Math.max(1, total)
    }
    const rightStart = Math.floor(width * 0.75)
    const bottomStart = Math.floor(height * 0.75)
    return {
      width,
      height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      rightCoverage: coverage(rightStart, 0, width - rightStart, height),
      bottomCoverage: coverage(0, bottomStart, width, height - bottomStart),
    }
  })
}

async function startVideoServer(filePath) {
  const size = (await stat(filePath)).size
  const server = createHttpServer((request, response) => {
    if (request.url !== '/benchmark-video.mp4') {
      response.writeHead(404)
      response.end()
      return
    }
    const headers = {
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'video/mp4',
    }
    if (request.method === 'HEAD') {
      response.writeHead(200, { ...headers, 'Content-Length': size })
      response.end()
      return
    }
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
    if (!range) {
      response.writeHead(200, { ...headers, 'Content-Length': size })
      createReadStream(filePath).pipe(response)
      return
    }
    const start = range[1] ? Number(range[1]) : 0
    const requestedEnd = range[2] ? Number(range[2]) : size - 1
    const end = Math.min(requestedEnd, size - 1)
    if (start < 0 || start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` })
      response.end()
      return
    }
    response.writeHead(206, {
      ...headers,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
    })
    createReadStream(filePath, { start, end }).pipe(response)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { server, url: `http://127.0.0.1:${port}/benchmark-video.mp4` }
}

async function runNative(composition, width, height, times, outputRoot) {
  assert.ok(native, 'Rust/WGPU 基准未启用')
  native.initCompositor(path.join(outputRoot, 'native-benchmark.log'))
  const warmupStartedAt = performance.now()
  const warmup = native.renderCompositionFrame({
    ffmpegPath,
    ffprobePath,
    composition: JSON.parse(JSON.stringify(composition)),
    time: 0,
    maxSide: MAX_SIDE,
  })
  const warmupMs = performance.now() - warmupStartedAt
  assert.ok(warmup?.data?.length > 0, 'Rust/WGPU 预热没有输出画面')
  const samples = []
  for (const time of times) {
    const startedAt = performance.now()
    const result = native.renderCompositionFrame({
      ffmpegPath,
      ffprobePath,
      composition: JSON.parse(JSON.stringify(composition)),
      time,
      maxSide: MAX_SIDE,
    })
    samples.push(performance.now() - startedAt)
    assert.ok(result?.data?.length > 0, `Rust/WGPU 在 ${time}s 没有输出画面`)
  }
  return {
    renderer: 'rust-wgpu',
    warmupMs: round(warmupMs),
    frame: summarize(samples),
    targetFps: TARGET_FPS,
    sampleTimes: times,
  }
}

async function runWebGpu(config, width, height, videoUrl) {
  const port = await reservePort()
  const vite = await createViteServer({
    configFile: false,
    root: projectRoot,
    clearScreen: false,
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  await vite.listen()
  const chromiumArgs = ['--enable-unsafe-webgpu', '--force-device-scale-factor=1']
  if (process.platform === 'darwin') chromiumArgs.push('--use-angle=metal')
  const browser = await chromium.launch({ headless: true, args: chromiumArgs })
  // Keep the page viewport aligned with the standalone canvas CSS size. The
  // renderer still receives the requested logical size below, so this keeps
  // the 480x270 logical / 960x540 presentation regression case meaningful.
  const context = await browser.newContext({ viewport: { width: PRESENTATION_WIDTH, height: PRESENTATION_HEIGHT }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const runtimeErrors = []
  const runtimeWarnings = []
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
    if (message.type() === 'warning') runtimeWarnings.push(`console: ${message.text()}`)
  })
  try {
    await page.goto(`http://127.0.0.1:${port}/webgpu-comparison.html`, { waitUntil: 'domcontentloaded' })
    const measurements = {}
    for (const feature of config.features) {
      const initialized = await page.evaluate((next) => window.lunaWebGpuComparison?.initialize(next), {
        canvasWidth: width,
        canvasHeight: height,
        presentationWidth: PRESENTATION_WIDTH,
        presentationHeight: PRESENTATION_HEIGHT,
        maxSide: MAX_SIDE,
        waitForGpu: WAIT_FOR_GPU,
        lutText: config.lutText,
        fontPath: FONT_PATH,
        fontData: config.fontData,
        mask: config.mask,
        features: [{
          ...feature,
          layers: feature.layers.map((layer) => ({
            ...layer,
            filePath: layer.filePath === config.nativeWatermarkPath ? config.watermarkDataUrl : layer.filePath,
          })),
        }],
      })
      const initialCanvas = await inspectCanvas(page)
      // The renderer owns the canvas backing store. The presentation viewport
      // remains 960x540 CSS pixels, while the GPU target follows the requested
      // logical render size (including the 4K benchmark).
      assert.equal(initialCanvas.width, width, `WebGPU backing 宽度错误: ${initialCanvas.width}`)
      assert.equal(initialCanvas.height, height, `WebGPU backing 高度错误: ${initialCanvas.height}`)
      assert.equal(initialized?.navigatorGpu, true, '当前 Chromium 没有可用的 WebGPU')
      try {
        const measurement = await page.evaluate((input) => window.lunaWebGpuComparison?.measureVideo(input.id, input.duration), {
          id: feature.id,
          duration: BENCHMARK_DURATION_MS,
        })
        assert.ok(measurement, `WebGPU 视频基准没有返回结果: ${feature.id}`)
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        // At 4K, the first measured interval can finish while large video,
        // LUT, mask, and text resources are still being uploaded. Render one
        // settled frame before checking edge coverage.
        await page.evaluate((featureId) => window.lunaWebGpuComparison?.renderFeature(featureId), feature.id)
        const canvas = await inspectCanvas(page)
        if (process.env.LUNA_WEBGPU_BENCHMARK_SCREENSHOT === '1') {
          await page.locator('#comparison-canvas').screenshot({ path: path.join(outputRoot, `${feature.id}-webgpu.png`) })
        }
        assert.ok(canvas.rightCoverage >= 0.95, `${feature.id} WebGPU 画面右侧覆盖率不足: ${canvas.rightCoverage}`)
        assert.ok(canvas.bottomCoverage >= 0.95, `${feature.id} WebGPU 画面下侧覆盖率不足: ${canvas.bottomCoverage}`)
        measurements[feature.id] = { ...measurement, canvas }
      } finally {
        await page.evaluate(() => window.lunaWebGpuComparison?.destroy()).catch(() => undefined)
      }
    }
    return { renderer: 'webgpu', targetFps: TARGET_FPS, measurements, runtimeErrors, runtimeWarnings, videoUrl }
  } finally {
    await page.evaluate(() => window.lunaWebGpuComparison?.destroy()).catch(() => undefined)
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
    await vite.close().catch(() => undefined)
  }
}

const sourceStat = await stat(inputPath).catch(() => null)
assert.ok(sourceStat?.isFile(), `视频不存在: ${inputPath}`)
assert.ok((await stat(LUT_PATH)).isFile(), `LUT 不存在: ${LUT_PATH}`)
assert.ok((await stat(WATERMARK_PATH)).isFile(), `水印素材不存在: ${WATERMARK_PATH}`)
assert.ok((await stat(FONT_PATH)).isFile(), `字体不存在: ${FONT_PATH}`)

const source = await probeVideo(inputPath)
const width = MAX_SIDE
const height = Math.max(2, Math.round(width * Number(source.height) / Number(source.width) / 2) * 2)
const mask = makeMask()
const outputRoot = path.resolve(process.env.LUNA_WEBGPU_BENCHMARK_OUTPUT_DIR ?? await mkdtemp(path.join(tmpdir(), 'luna-webgpu-benchmark-')))
await mkdir(outputRoot, { recursive: true })
const benchmarkVideoPath = USE_ORIGINAL_VIDEO ? inputPath : path.join(outputRoot, 'benchmark-video.mp4')
if (!USE_ORIGINAL_VIDEO) await createBenchmarkVideo(inputPath, benchmarkVideoPath, width, height)
const benchmarkVideo = await probeVideo(benchmarkVideoPath)
const maskPath = path.join(outputRoot, 'benchmark-mask.pgm')
await writeFile(maskPath, Buffer.concat([Buffer.from(`P5\n${mask.width} ${mask.height}\n255\n`, 'ascii'), mask.bytes]))
const watermarkDataUrl = `data:image/png;base64,${(await readFile(WATERMARK_PATH)).toString('base64')}`
const lutText = await readFile(LUT_PATH, 'utf8')
const fontData = (await readFile(FONT_PATH)).toString('base64')
const videoServer = await startVideoServer(benchmarkVideoPath)
const times = Array.from({ length: FRAME_COUNT }, (_, index) => round((index + 1) / TARGET_FPS))
const nativeFeatures = USE_ORIGINAL_VIDEO && !BASELINE_ONLY
  ? [{ id: 'full-stack', layers: fullStackLayers(benchmarkVideoPath, { maskPath, lutPath: LUT_PATH, watermarkPath: WATERMARK_PATH }) }]
  : [
      { id: 'baseline', layers: [videoLayer(benchmarkVideoPath)] },
      ...(BASELINE_ONLY ? [] : [{ id: 'full-stack', layers: fullStackLayers(benchmarkVideoPath, { maskPath, lutPath: LUT_PATH, watermarkPath: WATERMARK_PATH }) }]),
    ]
const webgpuFeatures = USE_ORIGINAL_VIDEO && !BASELINE_ONLY
  ? [{ id: 'full-stack', layers: fullStackLayers(videoServer.url, { maskPath: 'fixture://mask', lutPath: 'fixture://lut', watermarkPath: 'fixture://watermark' }) }]
  : [
      { id: 'baseline', layers: [videoLayer(videoServer.url)] },
      ...(BASELINE_ONLY ? [] : [{ id: 'full-stack', layers: fullStackLayers(videoServer.url, { maskPath: 'fixture://mask', lutPath: 'fixture://lut', watermarkPath: 'fixture://watermark' }) }]),
    ]
let webgpuResult = {
  renderer: 'webgpu',
  targetFps: TARGET_FPS,
  measurements: {},
  runtimeErrors: [],
  runtimeWarnings: [],
  videoUrl: videoServer.url,
}
try {
  if (!SKIP_WEBGPU) {
    webgpuResult = await runWebGpu({
      features: webgpuFeatures,
      nativeWatermarkPath: 'fixture://watermark',
      watermarkDataUrl,
      lutText,
      fontData,
      mask,
    }, width, height, videoServer.url)
  }
} finally {
  await new Promise((resolve) => videoServer.server.close(resolve))
}
const nativeResults = {}
const nativeErrors = {}
if (!SKIP_NATIVE) {
  for (const feature of nativeFeatures) {
    const composition = buildCompositionFromPreviewLayers(feature.layers, width, height, { fps: TARGET_FPS, duration: FRAME_COUNT / TARGET_FPS })
    try {
      nativeResults[feature.id] = await runNative(composition, width, height, times, outputRoot)
    } catch (error) {
      nativeErrors[feature.id] = error instanceof Error ? error.message : String(error)
      break
    }
  }
}
const comparisons = nativeFeatures.map((feature) => {
  const nativeResult = nativeResults[feature.id]
  const webgpuMeasurement = webgpuResult.measurements[feature.id]
  const webgpuRenderSamples = webgpuMeasurement
    ? webgpuMeasurement.renderTimes.slice(1).map((time, index) => time - webgpuMeasurement.renderTimes[index])
    : []
  return {
    feature: feature.id,
    native: nativeResult ?? { renderer: 'rust-wgpu', error: nativeErrors[feature.id] ?? '未运行' },
    webgpu: webgpuMeasurement ? {
      renderer: webgpuResult.renderer,
      targetFps: webgpuResult.targetFps,
      elapsedMs: webgpuMeasurement.elapsedMs,
      rendererFrames: webgpuMeasurement.rendererFrames,
      rendererFps: round(webgpuMeasurement.rendererFrames * 1000 / Math.max(1, webgpuMeasurement.elapsedMs)),
      videoFrameCallbacks: webgpuMeasurement.videoFrameCallbacks,
      videoCallbackFps: round(webgpuMeasurement.videoFrameCallbacks * 1000 / Math.max(1, webgpuMeasurement.elapsedMs)),
      presentedFrames: webgpuMeasurement.presentedFrames,
      firstRenderMs: webgpuMeasurement.firstRenderMs,
      canvas: webgpuMeasurement.canvas,
      renderInterval: summarize(webgpuRenderSamples),
      quality: {
        totalVideoFrames: deltaQuality(webgpuMeasurement.qualityBefore, webgpuMeasurement.qualityAfter, 'totalVideoFrames'),
        droppedVideoFrames: deltaQuality(webgpuMeasurement.qualityBefore, webgpuMeasurement.qualityAfter, 'droppedVideoFrames'),
        corruptedVideoFrames: deltaQuality(webgpuMeasurement.qualityBefore, webgpuMeasurement.qualityAfter, 'corruptedVideoFrames'),
      },
      video: webgpuMeasurement.video,
    } : { renderer: 'webgpu', error: SKIP_WEBGPU ? '未运行' : '没有返回结果' },
  }
})
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'standalone-video-rust-wgpu-vs-webgpu',
  source: {
    path: inputPath,
    width: Number(source.width),
    height: Number(source.height),
    duration: Number(source.duration),
    sourceFps: parseRate(source.avg_frame_rate ?? source.r_frame_rate),
    codec: source.codec_name,
    pixelFormat: source.pix_fmt,
  },
  benchmarkVideo: {
    path: benchmarkVideoPath,
    isOriginal: USE_ORIGINAL_VIDEO,
    width: Number(benchmarkVideo.width),
    height: Number(benchmarkVideo.height),
    duration: Number(benchmarkVideo.duration),
    fps: parseRate(benchmarkVideo.avg_frame_rate ?? benchmarkVideo.r_frame_rate),
    codec: benchmarkVideo.codec_name,
  },
  policy: {
    canvasWidth: width,
    canvasHeight: height,
    presentationWidth: PRESENTATION_WIDTH,
    presentationHeight: PRESENTATION_HEIGHT,
    waitForGpu: WAIT_FOR_GPU,
    maxSide: MAX_SIDE,
    targetFps: TARGET_FPS,
    sampledFrames: FRAME_COUNT,
    benchmarkDurationMs: BENCHMARK_DURATION_MS,
    oneVideo: true,
    fullStackLayers: nativeFeatures.find((feature) => feature.id === 'full-stack')?.layers.length ?? 0,
    electron: false,
    ai: false,
    chromiumPages: 1,
    skipNative: SKIP_NATIVE,
    skipWebgpu: SKIP_WEBGPU,
  },
  comparisons,
  nativeErrors,
  webgpuRuntimeErrors: webgpuResult.runtimeErrors,
  webgpuRuntimeWarnings: webgpuResult.runtimeWarnings,
  outputRoot,
}
await writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
assert.deepEqual(webgpuResult.runtimeErrors, [])
