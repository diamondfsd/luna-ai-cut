#!/usr/bin/env node
/* global Buffer */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
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
const native = require(path.join(projectRoot, 'luna-render-core', 'luna-render-core.node'))
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path

const DEFAULT_VIDEO_PATH = '/Users/zhouchao/照片同步/lunaultra/2026-06-19/VID_20260619_174718_031.mp4'
const inputPath = path.resolve(process.env.LUNA_WEBGPU_EXPORT_VIDEO ?? process.argv[2] ?? DEFAULT_VIDEO_PATH)
const LUT_PATH = path.join(projectRoot, 'public', 'luts', '徕卡', 'Leica Classic.cube')
const WATERMARK_PATH = path.join(projectRoot, 'src', 'assets', 'watermark', 'ic_watermark_luna_ultra_image_cn.png')
const FONT_PATH = path.join(projectRoot, 'public', 'fonts', 'SourceHanSansSC-Regular.otf')
const MAX_SIDE = Math.max(360, Number(process.env.LUNA_WEBGPU_EXPORT_MAX_SIDE ?? 960))
const FPS = 30
// Four frames are enough to expose export throughput while keeping this
// standalone comparison bounded on machines where a full-resolution render is expensive.
const FRAME_COUNT = Math.max(1, Math.min(12, Math.round(Number(process.env.LUNA_WEBGPU_EXPORT_FRAMES ?? 4))))
const DURATION = FRAME_COUNT / FPS
const CODEC = 'avc1.4D002A'
const BITRATE = 12_000_000
const LAYER_LIMIT = Math.max(0, Math.round(Number(process.env.LUNA_WEBGPU_EXPORT_LAYER_LIMIT ?? 0)))

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
    videoOffset: 0, videoDuration: DURATION, fit: 'cover',
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
  const base = videoLayer(sourcePath)
  const maskedColor = videoLayer(sourcePath, {
    layerType: 'local-color',
    zIndex: 1,
    maskPath: resources.maskPath,
    maskProjectId: 'benchmark-mask-project',
    maskOpacity: 0.82,
    maskFeather: 8,
    blendMode: 'screen',
    ...(process.env.LUNA_WEBGPU_EXPORT_NO_MASK_LUT === '1' ? {} : { lutId: resources.lutPath, lutIntensity: 62 }),
  })
  return [
    base,
    maskedColor,
    videoLayer(sourcePath, {
      zIndex: 2,
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

function staticFrameLayers(sourcePath, resources) {
  return fullStackLayers(sourcePath, resources).map((layer) => layer.isVideo
    ? { ...layer, isVideo: false, videoSourceKey: undefined, videoTime: undefined, videoDuration: undefined }
    : layer)
}

async function probeVideo(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,duration,avg_frame_rate,r_frame_rate,nb_frames,codec_name,pix_fmt',
    '-of', 'json', filePath,
  ])
  const stream = JSON.parse(stdout).streams?.[0]
  assert.ok(stream?.width && stream?.height && stream?.duration, `视频元数据读取失败: ${filePath}`)
  return stream
}

async function decodeFirstFrameRgba(filePath, width, height) {
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-i', filePath,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-frames:v', '1', 'pipe:1',
  ], { encoding: 'buffer', maxBuffer: width * height * 8 })
  const frame = Buffer.from(stdout)
  assert.equal(frame.length, width * height * 4, `首帧解码尺寸不匹配: ${filePath}`)
  return frame
}

function compareRgbaFrames(nativeFrame, webgpuFrame) {
  assert.equal(nativeFrame.length, webgpuFrame.length, '两份导出首帧尺寸不一致')
  let sum = 0
  let max = 0
  let differentPixels = 0
  for (let index = 0; index < nativeFrame.length; index += 4) {
    let pixelDelta = 0
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(nativeFrame[index + channel] - webgpuFrame[index + channel])
      sum += delta
      pixelDelta = Math.max(pixelDelta, delta)
      max = Math.max(max, delta)
    }
    if (pixelDelta > 2) differentPixels += 1
  }
  const pixels = nativeFrame.length / 4
  return {
    meanAbsDeltaRgb: round(sum / Math.max(1, pixels * 3)),
    maxAbsDeltaRgb: max,
    differentPixelRatio: round(differentPixels / Math.max(1, pixels)),
  }
}

async function createBenchmarkVideo(inputFilePath, outputFilePath, width, height) {
  await execFileAsync(ffmpegPath, [
    '-y', '-v', 'error', '-i', inputFilePath,
    '-vf', `scale=${width}:${height}`,
    '-t', String((FRAME_COUNT + 4) / FPS),
    '-r', String(FPS), '-an',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', outputFilePath,
  ])
}

async function extractBenchmarkFrames(videoPath, outputRoot, width, height) {
  const framePattern = path.join(outputRoot, 'source-frame-%02d.png')
  await execFileAsync(ffmpegPath, [
    '-y', '-v', 'error', '-i', videoPath,
    '-vf', `scale=${width}:${height}:flags=lanczos`,
    '-frames:v', String(FRAME_COUNT), '-an', '-compression_level', '3', framePattern,
  ])
  return Promise.all(Array.from({ length: FRAME_COUNT }, async (_, index) => {
    const framePath = path.join(outputRoot, `source-frame-${String(index + 1).padStart(2, '0')}.png`)
    const frame = await readFile(framePath)
    return { path: framePath, dataUrl: `data:image/png;base64,${frame.toString('base64')}` }
  }))
}

function parseRate(value) {
  if (typeof value !== 'string' || !value.includes('/')) return null
  const [numerator, denominator] = value.split('/').map(Number)
  return denominator > 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : null
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

async function runNativeExport(composition, outputPath, logPath) {
  native.initCompositor(logPath)
  const startedAt = performance.now()
  await native.exportCompositionVideoAsync({
    ffmpegPath,
    ffprobePath,
    outputPath,
    composition: JSON.parse(JSON.stringify(composition)),
    fps: FPS,
    duration: DURATION,
    hardware: true,
    taskId: 'benchmark-native-export',
    qualityPreset: 'standard',
    includeAudio: false,
  })
  const elapsedMs = performance.now() - startedAt
  const output = await probeVideo(outputPath)
  return {
    renderer: 'rust-wgpu',
    elapsedMs: round(elapsedMs),
    frames: Number(output.nb_frames ?? 0),
    fps: round(FRAME_COUNT * 1000 / Math.max(1, elapsedMs)),
    output: {
      path: outputPath,
      width: Number(output.width),
      height: Number(output.height),
      duration: Number(output.duration),
      codec: output.codec_name,
      frameRate: parseRate(output.avg_frame_rate ?? output.r_frame_rate),
    },
  }
}

async function runWebGpuWebCodecsExport({ feature, width, height, watermarkDataUrl, lutText, fontData, mask }) {
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
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const runtimeErrors = []
  const runtimeWarnings = []
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'log') console.log(`[webgpu ${message.type()}] ${message.text()}`)
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
    if (message.type() === 'warning') runtimeWarnings.push(`console: ${message.text()}`)
  })
  try {
    await page.goto(`http://127.0.0.1:${port}/webgpu-comparison.html`, { waitUntil: 'domcontentloaded' })
    const replaceFixturePaths = (layers) => layers.map((layer) => ({
      ...layer,
      filePath: layer.filePath === 'fixture://watermark' ? watermarkDataUrl : layer.filePath,
    }))
    const initialized = await page.evaluate((next) => window.lunaWebGpuComparison?.initialize(next), {
      canvasWidth: width,
      canvasHeight: height,
      maxSide: MAX_SIDE,
      // The headless Metal backend can leave onSubmittedWorkDone pending
      // after a canvas copy. Render callbacks still provide a bounded frame
      // boundary for this standalone benchmark.
      waitForGpu: true,
      lutText,
      fontPath: FONT_PATH,
      fontData,
      mask,
      features: [{
        ...feature,
        layers: replaceFixturePaths(feature.layers),
        frameLayers: feature.frameLayers?.map(replaceFixturePaths),
      }],
    })
    assert.equal(initialized?.navigatorGpu, true, '当前 Chromium 没有可用的 WebGPU')
    if (process.env.LUNA_WEBGPU_EXPORT_SCREENSHOT === '1') {
      const preflight = await page.evaluate((id) => window.lunaWebGpuComparison?.renderFeature(id), feature.id)
      assert.ok(preflight, 'WebGPU 导出前置画面没有返回结果')
      await page.locator('#comparison-canvas').screenshot({ path: path.join(path.dirname(feature.outputPath), 'webgpu-preflight.png') })
    }
    const result = await page.evaluate((input) => window.lunaWebGpuComparison?.exportVideo(input.id, input.frameCount, input.fps, input.codec, input.bitrate), {
      id: feature.id,
      frameCount: FRAME_COUNT,
      fps: FPS,
      codec: CODEC,
      bitrate: BITRATE,
    })
    assert.ok(result, 'WebGPU + WebCodecs 导出没有返回结果')
    assert.ok(result.chunks.length > 0, 'WebCodecs 没有生成编码数据')
    if (process.env.LUNA_WEBGPU_EXPORT_SCREENSHOT === '1') {
      await page.locator('#comparison-canvas').screenshot({ path: path.join(path.dirname(feature.outputPath), 'webgpu-canvas.png') })
    }
    const encodedBytes = Buffer.concat(result.chunks.map((chunk) => Buffer.from(chunk.data)))
    assert.ok(encodedBytes.length > 0, 'WebCodecs 编码数据为空')
    const encodedPath = path.join(path.dirname(feature.outputPath), 'webcodecs.h264')
    await writeFile(encodedPath, encodedBytes)
    await execFileAsync(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-r', String(FPS), '-f', 'h264', '-i', encodedPath,
      '-c:v', 'copy', '-movflags', '+faststart', feature.outputPath,
    ])
    const output = await probeVideo(feature.outputPath)
    return {
      renderer: 'webgpu+webcodecs',
      elapsedMs: result.elapsedMs,
      renderMs: result.renderMs,
      encodeMs: result.encodeMs,
      readbackMs: result.readbackMs,
      flushMs: result.flushMs,
      frames: result.frames,
      keyFrames: result.keyFrames,
      encodedBytes: encodedBytes.length,
      codec: result.codec,
      runtimeErrors,
      runtimeWarnings,
      output: {
        path: feature.outputPath,
        width: Number(output.width),
        height: Number(output.height),
        duration: Number(output.duration),
        codec: output.codec_name,
        frameRate: parseRate(output.avg_frame_rate ?? output.r_frame_rate),
        frames: Number(output.nb_frames ?? 0),
      },
      video: { width: result.width, height: result.height },
    }
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
assert.equal(Number(source.width), 3840, `测试素材不是 4K 宽度: ${source.width}`)
assert.equal(Number(source.height), 2160, `测试素材不是 4K 高度: ${source.height}`)
const width = MAX_SIDE
const height = Math.max(2, Math.round(width * Number(source.height) / Number(source.width) / 2) * 2)
const outputRoot = path.resolve(process.env.LUNA_WEBGPU_EXPORT_OUTPUT_DIR ?? await mkdtemp(path.join(tmpdir(), 'luna-webgpu-export-')))
await mkdir(outputRoot, { recursive: true })
const benchmarkVideoPath = path.join(outputRoot, 'benchmark-video.mp4')
await createBenchmarkVideo(inputPath, benchmarkVideoPath, width, height)
const benchmarkVideo = await probeVideo(benchmarkVideoPath)
const mask = makeMask()
const maskPath = path.join(outputRoot, 'benchmark-mask.pgm')
await writeFile(maskPath, Buffer.concat([Buffer.from(`P5\n${mask.width} ${mask.height}\n255\n`, 'ascii'), mask.bytes]))
const watermarkDataUrl = `data:image/png;base64,${(await readFile(WATERMARK_PATH)).toString('base64')}`
const lutText = await readFile(LUT_PATH, 'utf8')
const fontData = (await readFile(FONT_PATH)).toString('base64')
const nativeOutputPath = path.join(outputRoot, 'rust-wgpu-export.mp4')
const webgpuOutputPath = path.join(outputRoot, 'webgpu-webcodecs-export.mp4')
const frameInputs = await extractBenchmarkFrames(benchmarkVideoPath, outputRoot, width, height)
const exactFrameInput = process.env.LUNA_WEBGPU_EXPORT_EXACT_FRAME === '1' ? frameInputs[0]?.path : null
if (process.env.LUNA_WEBGPU_EXPORT_EXACT_FRAME === '1') assert.equal(FRAME_COUNT, 1, '同帧校验模式只支持 1 帧')
const fullNativeLayers = exactFrameInput
  ? staticFrameLayers(exactFrameInput, { maskPath, lutPath: LUT_PATH, watermarkPath: WATERMARK_PATH })
  : fullStackLayers(benchmarkVideoPath, { maskPath, lutPath: LUT_PATH, watermarkPath: WATERMARK_PATH })
const nativeLayers = LAYER_LIMIT > 0 ? fullNativeLayers.slice(0, LAYER_LIMIT) : fullNativeLayers
if (process.env.LUNA_WEBGPU_EXPORT_DEBUG_LAYERS === '1') console.log(JSON.stringify(nativeLayers.slice(0, 2), null, 2))
const composition = buildCompositionFromPreviewLayers(nativeLayers, width, height, { fps: FPS, duration: DURATION })
const webgpuFrameLayers = frameInputs.map(({ dataUrl }) => staticFrameLayers(dataUrl, {
  maskPath: 'fixture://mask',
  lutPath: 'fixture://lut',
  watermarkPath: 'fixture://watermark',
})).map((layers) => (LAYER_LIMIT > 0 ? layers.slice(0, LAYER_LIMIT) : layers))
if (process.env.LUNA_WEBGPU_EXPORT_DEBUG_LAYERS === '1') console.log(JSON.stringify(webgpuFrameLayers[0]?.slice(0, 2), null, 2))
let nativeResult
let webgpuResult
nativeResult = await runNativeExport(composition, nativeOutputPath, path.join(outputRoot, 'native-export.log'))
webgpuResult = await runWebGpuWebCodecsExport({
  feature: { id: 'full-stack', layers: webgpuFrameLayers[0].slice(), frameLayers: webgpuFrameLayers.map((layers) => layers.slice()), outputPath: webgpuOutputPath },
  width,
  height,
  watermarkDataUrl,
  lutText,
  fontData,
  mask,
})
const nativeFirstFrame = await decodeFirstFrameRgba(nativeOutputPath, width, height)
const webgpuFirstFrame = await decodeFirstFrameRgba(webgpuOutputPath, width, height)

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'standalone-export-rust-wgpu-vs-webgpu-webcodecs-frame-sequence',
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
    width: Number(benchmarkVideo.width),
    height: Number(benchmarkVideo.height),
    duration: Number(benchmarkVideo.duration),
    fps: parseRate(benchmarkVideo.avg_frame_rate ?? benchmarkVideo.r_frame_rate),
    codec: benchmarkVideo.codec_name,
  },
  benchmarkFrames: {
    count: frameInputs.length,
    width,
    height,
    source: 'ffmpeg-decoded lossless PNG frames from the real 4K source',
  },
  policy: {
    canvasWidth: width,
    canvasHeight: height,
    maxSide: MAX_SIDE,
    targetFps: FPS,
    frames: FRAME_COUNT,
    duration: DURATION,
    fullStackLayers: nativeLayers.length,
    electron: false,
    audio: false,
    ai: false,
    chromiumPages: 1,
    exactFrameInput: Boolean(exactFrameInput),
  },
  comparisons: {
    native: nativeResult,
    webgpuWebCodecs: webgpuResult,
    firstFrame: compareRgbaFrames(nativeFirstFrame, webgpuFirstFrame),
  },
  outputRoot,
}
await writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
assert.deepEqual(webgpuResult.runtimeErrors, [])
assert.equal(nativeResult.output.width, width)
assert.equal(nativeResult.output.height, height)
assert.equal(webgpuResult.output.width, width)
assert.equal(webgpuResult.output.height, height)
