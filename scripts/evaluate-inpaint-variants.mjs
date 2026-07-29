#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  compositeInpaintRegion,
  createInpaintMaskJobs,
  dilateInpaintMask,
  featherInpaintMask,
  INPAINT_MODEL_SIZE,
  modelRadiusForSourcePixels,
  prepareInpaintInputs,
} from '../electron/inpaintMask.ts'

function parseArgs() {
  const values = new Map()
  for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1])
  const manifest = values.get('--manifest')
  const output = values.get('--output')
  const model = values.get('--model')
  if (!manifest || !output || !model) throw new Error('Usage: --manifest FILE --output DIR --model FILE')
  return { manifest, output, model }
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(stdout))
      : reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${executable} failed`)))
    child.stdin.end(options.input)
  })
}

async function imageSize(filePath) {
  const output = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath])
  const stream = JSON.parse(output.toString('utf8')).streams?.[0]
  if (!stream?.width || !stream?.height) throw new Error(`Cannot probe ${filePath}`)
  return { width: stream.width, height: stream.height }
}

async function decodeRgb(filePath, width, height) {
  return run('ffmpeg', ['-v', 'error', '-i', filePath, '-vf', `scale=${width}:${height}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
}

async function decodeMask(filePath, width, height) {
  return new Uint8Array(await run('ffmpeg', ['-v', 'error', '-i', filePath, '-vf', `scale=${width}:${height}:flags=neighbor`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']))
}

function baselineRegion(mask, maskWidth, maskHeight, sourceWidth, sourceHeight) {
  let left = maskWidth
  let top = maskHeight
  let right = -1
  let bottom = -1
  for (let y = 0; y < maskHeight; y++) for (let x = 0; x < maskWidth; x++) {
    if (mask[y * maskWidth + x] < 16) continue
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Empty evaluation mask')
  left = Math.floor(left * sourceWidth / maskWidth)
  top = Math.floor(top * sourceHeight / maskHeight)
  right = Math.ceil((right + 1) * sourceWidth / maskWidth)
  bottom = Math.ceil((bottom + 1) * sourceHeight / maskHeight)
  const span = Math.max(right - left, bottom - top)
  const size = Math.min(Math.max(sourceWidth, sourceHeight), Math.max(INPAINT_MODEL_SIZE, Math.ceil(span * 3)))
  const place = (center, sourceSize) => Math.max(Math.min(0, sourceSize - size), Math.min(Math.max(0, sourceSize - size), Math.round(center - size / 2)))
  return { x: place((left + right) / 2, sourceWidth), y: place((top + bottom) / 2, sourceHeight), size }
}

async function evaluateVariant({ name, jobs, original, width, height, maskWidth, maskHeight, edgeExpansion, feather, model, worker, outputDir }) {
  const temporary = await mkdtemp(path.join(tmpdir(), `luna-inpaint-eval-${name}-`))
  try {
    const prepared = jobs.map((job, index) => {
      const input = prepareInpaintInputs(original, width, height, job.mask, maskWidth, maskHeight, job.region)
      const modelMask = dilateInpaintMask(input.mask, modelRadiusForSourcePixels(edgeExpansion, job.region))
      return {
        ...job,
        input: input.rgb,
        modelMask,
        alpha: featherInpaintMask(modelMask, modelRadiusForSourcePixels(feather, job.region)),
        inputPath: path.join(temporary, `input-${index}.rgb`),
        maskPath: path.join(temporary, `mask-${index}.raw`),
        outputPath: path.join(temporary, `output-${index}.rgb`),
      }
    })
    const batchPath = path.join(temporary, 'jobs.json')
    const metricsPath = path.join(temporary, 'metrics.json')
    await Promise.all([
      ...prepared.flatMap((job) => [writeFile(job.inputPath, job.input), writeFile(job.maskPath, job.modelMask)]),
      writeFile(batchPath, JSON.stringify({ jobs: prepared.map(({ inputPath, maskPath, outputPath }) => ({ inputPath, maskPath, outputPath })) })),
    ])
    await run(worker, [model, batchPath, metricsPath])
    const [generated, metrics] = await Promise.all([
      Promise.all(prepared.map((job) => readFile(job.outputPath))),
      readFile(metricsPath, 'utf8').then(JSON.parse),
    ])
    let composite = Buffer.from(original)
    for (let index = 0; index < prepared.length; index++) {
      composite = compositeInpaintRegion(composite, width, height, generated[index], prepared[index].alpha, prepared[index].region)
    }
    const outputPath = path.join(outputDir, `${name}.png`)
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', outputPath], { input: composite })
    return { ...metrics, outputPath }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function main() {
  const args = parseArgs()
  const worker = path.resolve(import.meta.dirname, '..', 'luna-render-core', process.platform === 'win32' ? 'luna-inpaint-worker.exe' : 'luna-inpaint-worker')
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'))
  await mkdir(args.output, { recursive: true })
  const results = []
  for (const sample of manifest.samples) {
    const sampleOutput = path.join(args.output, sample.sampleId)
    await mkdir(sampleOutput, { recursive: true })
    const { width, height } = await imageSize(sample.imagePath)
    const original = await decodeRgb(sample.imagePath, width, height)
    const mask = await decodeMask(sample.maskPath, sample.maskWidth ?? width, sample.maskHeight ?? height)
    const maskWidth = sample.maskWidth ?? width
    const maskHeight = sample.maskHeight ?? height
    const baselineJobs = [{ mask, region: baselineRegion(mask, maskWidth, maskHeight, width, height) }]
    const adaptiveJobs = createInpaintMaskJobs(mask, maskWidth, maskHeight, width, height)
    const baseline = await evaluateVariant({ name: 'baseline', jobs: baselineJobs, original, width, height, maskWidth, maskHeight, edgeExpansion: 0, feather: 0, model: args.model, worker, outputDir: sampleOutput })
    const adaptive = await evaluateVariant({ name: 'adaptive', jobs: adaptiveJobs, original, width, height, maskWidth, maskHeight, edgeExpansion: 4, feather: 2, model: args.model, worker, outputDir: sampleOutput })
    results.push({ ...sample, width, height, baseline, adaptive })
    console.log(`${sample.sampleId}: baseline=${baseline.inferenceMs}ms adaptive=${adaptive.inferenceMs}ms regions=${adaptive.regionCount}`)
  }
  await writeFile(path.join(args.output, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), samples: results }, null, 2))
}

await main()
