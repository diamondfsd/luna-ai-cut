/* global process */
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const datasetRoot = path.join(repositoryRoot, 'test-data', 'color-masking', 'd3-effect-set')
const manifestPath = path.join(datasetRoot, 'manifest.json')
const modelDir = argument('--model-dir') ?? process.env.LUNA_MASK_MODEL_DIR ?? path.join(tmpdir(), 'luna-mask-models')
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const outputRoot = path.resolve(argument('--output') ?? path.join(repositoryRoot, 'test-results', 'color-masking', runId))
const targetFilter = new Set((argument('--targets') ?? '').split(',').filter(Boolean))
const limit = Number(argument('--limit') ?? Number.POSITIVE_INFINITY)
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg'
const specializedWorkerPath = path.join(repositoryRoot, 'luna-render-core', 'specialized-segmentation-worker')

const modelSpecs = {
  sky: {
    id: 'segformer-b5-ade20k',
    file: 'segformer-b5-ade20k.onnx',
    sha256: '7b20b28f213e6d1128cb850c3fa273a061f0aa87a49224316791fdab49515a51',
    backend: 'semantic',
    classId: 2,
    inputSize: 640,
  },
  water: {
    id: 'segformer-b5-ade20k',
    file: 'segformer-b5-ade20k.onnx',
    sha256: '7b20b28f213e6d1128cb850c3fa273a061f0aa87a49224316791fdab49515a51',
    backend: 'semantic',
    classId: 21,
    inputSize: 640,
  },
  person: {
    id: 'yolo26s-seg',
    file: 'yolo26s-seg.onnx',
    sha256: 'd205b2c489e7cf0cdb183bb23e56dc8a32a79602e8c5b1f5ecb01af0dc6822c3',
    backend: 'yolo26-seg',
    inputSize: 640,
  },
  subject: {
    id: 'birefnet-general-lite',
    file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    backend: 'birefnet-general-lite',
    inputSize: 1024,
  },
  tree: {
    id: 'segformer-b5-ade20k',
    file: 'segformer-b5-ade20k.onnx',
    sha256: '7b20b28f213e6d1128cb850c3fa273a061f0aa87a49224316791fdab49515a51',
    backend: 'semantic',
    classId: 4,
    inputSize: 640,
  },
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function rounded(milliseconds) {
  return Math.round(milliseconds * 100) / 100
}

function createSpecializedWorker() {
  const worker = spawn(specializedWorkerPath, ['--server'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let stdout = ''
  let stderr = ''
  worker.stdout.setEncoding('utf8')
  worker.stderr.setEncoding('utf8')
  worker.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_192) })
  worker.stdout.on('data', (chunk) => {
    stdout += chunk
    let newline = stdout.indexOf('\n')
    while (newline >= 0) {
      const line = stdout.slice(0, newline).trim()
      stdout = stdout.slice(newline + 1)
      if (line) {
        const response = JSON.parse(line)
        const request = pending.get(response.id)
        if (request) {
          pending.delete(response.id)
          clearTimeout(request.timer)
          if (response.kind === 'result') request.resolve(response)
          else request.reject(new Error(response.error ?? '专用分割工作进程响应无效'))
        }
      }
      newline = stdout.indexOf('\n')
    }
  })
  worker.once('exit', (code, signal) => {
    const error = new Error(stderr.trim() || `专用分割工作进程已退出 (${signal ?? code ?? 'unknown'})`)
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  })
  return {
    segment(command) {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.kill()
          reject(new Error('专用分割工作进程超时'))
        }, 90_000)
        pending.set(id, { resolve, reject, timer })
        worker.stdin.write(`${JSON.stringify({ id, op: 'segment', ...command })}\n`)
      })
    },
    close() {
      if (!worker.killed) worker.kill()
    },
  }
}

let specializedWorker

async function verifyModels(items) {
  const modelIds = new Set(items.map((item) => modelSpecs[item.target].id))
  const verifiedModelIds = new Set()
  for (const spec of Object.values(modelSpecs)) {
    if (!modelIds.has(spec.id) || verifiedModelIds.has(spec.id)) continue
    const modelPath = path.join(modelDir, spec.file)
    const actualSha = sha256(await readFile(modelPath))
    if (actualSha !== spec.sha256) throw new Error(`模型缺失或损坏: ${modelPath}`)
    verifiedModelIds.add(spec.id)
  }
}

function preprocessing(item, spec) {
  if (spec.backend === 'yolo26-seg') {
    const scale = Math.min(640 / item.width, 640 / item.height)
    const scaledWidth = Math.max(1, Math.round(item.width * scale))
    const scaledHeight = Math.max(1, Math.round(item.height * scale))
    const padX = Math.floor((640 - scaledWidth) / 2)
    const padY = Math.floor((640 - scaledHeight) / 2)
    return {
      filter: `scale=${scaledWidth}:${scaledHeight}:flags=bilinear,pad=640:640:${padX}:${padY}:color=0x727272`,
      scaledWidth,
      scaledHeight,
      padX,
      padY,
    }
  }
  return {
    filter: `scale=${spec.inputSize}:${spec.inputSize}:flags=bilinear`,
    scaledWidth: spec.inputSize,
    scaledHeight: spec.inputSize,
    padX: 0,
    padY: 0,
  }
}

async function evaluateItem(item, datasetSha) {
  const spec = modelSpecs[item.target]
  const imagePath = path.join(datasetRoot, item.file)
  const modelPath = path.join(modelDir, spec.file)
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-mask-eval-'))
  const rgbPath = path.join(temporaryRoot, 'input.rgb')
  const workerOutputPath = path.join(temporaryRoot, 'output.mask')
  const finalMaskPath = path.join(outputRoot, 'masks', item.target, `${item.id}.mask`)
  const startedAt = performance.now()
  try {
    const transform = preprocessing(item, spec)
    const prepareStartedAt = performance.now()
    await execFileAsync(ffmpeg, [
      '-v', 'error', '-y', '-i', imagePath,
      '-vf', transform.filter,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', rgbPath,
    ], { timeout: 30_000, maxBuffer: 64 * 1024 })
    const prepareMs = performance.now() - prepareStartedAt
    const inferenceStartedAt = performance.now()
    let sessionLoadMs = null
    let sessionReused = null
    let workerInferenceMs = null
    if (spec.backend === 'semantic') {
      await execFileAsync(path.join(repositoryRoot, 'luna-render-core', 'semantic-segmentation-worker'), [
        modelPath, rgbPath, workerOutputPath, '0.5', '0.5', String(spec.classId), String(spec.inputSize),
      ], { timeout: 90_000, maxBuffer: 64 * 1024 })
    } else {
      specializedWorker ??= createSpecializedWorker()
      const workerResult = await specializedWorker.segment({
        backend: spec.backend,
        modelPath,
        inputPath: rgbPath,
        outputPath: workerOutputPath,
        scaledWidth: transform.scaledWidth,
        scaledHeight: transform.scaledHeight,
        padX: transform.padX,
        padY: transform.padY,
        outputSize: 512,
      })
      sessionLoadMs = workerResult.sessionLoadMs
      sessionReused = workerResult.sessionReused
      workerInferenceMs = workerResult.inferenceMs
    }
    const workerRoundTripMs = performance.now() - inferenceStartedAt
    const inferenceMs = workerInferenceMs ?? workerRoundTripMs
    const workerBytes = await readFile(workerOutputPath)
    const width = spec.backend === 'semantic' ? workerBytes.readUInt32LE(0) : 512
    const height = spec.backend === 'semantic' ? workerBytes.readUInt32LE(4) : 512
    const returnedClassId = spec.backend === 'semantic' ? workerBytes.readUInt32LE(8) : null
    const mask = spec.backend === 'semantic' ? workerBytes.subarray(12) : workerBytes
    if (width !== 512 || height !== 512 || mask.length !== 512 * 512) {
      throw new Error(`蒙版尺寸异常: ${width}x${height}, ${mask.length} bytes`)
    }
    let nonzero = 0
    let visible = 0
    for (const alpha of mask) {
      if (alpha > 0) nonzero += 1
      if (alpha >= 128) visible += 1
    }
    const foregroundRatio = visible / mask.length
    const status = foregroundRatio === 0
      ? 'empty'
      : foregroundRatio < 0.0005
        ? 'near_empty'
        : foregroundRatio > 0.98
          ? 'near_full'
          : 'success'
    await mkdir(path.dirname(finalMaskPath), { recursive: true })
    await writeFile(finalMaskPath, mask)
    return {
      datasetSha256: datasetSha,
      imageId: item.id,
      target: item.target,
      modelId: spec.id,
      modelSha256: spec.sha256,
      status,
      prepareMs: rounded(prepareMs),
      sessionLoadMs,
      sessionReused,
      inferenceMs: rounded(inferenceMs),
      workerRoundTripMs: rounded(workerRoundTripMs),
      totalMs: rounded(performance.now() - startedAt),
      maskWidth: width,
      maskHeight: height,
      returnedClassId,
      foregroundRatio: Number(foregroundRatio.toFixed(6)),
      nonzeroRatio: Number((nonzero / mask.length).toFixed(6)),
      outputSha256: sha256(mask),
      errorCode: null,
    }
  } catch (error) {
    return {
      datasetSha256: datasetSha,
      imageId: item.id,
      target: item.target,
      modelId: spec.id,
      modelSha256: spec.sha256,
      status: 'error',
      prepareMs: null,
      sessionLoadMs: null,
      sessionReused: null,
      inferenceMs: null,
      workerRoundTripMs: null,
      totalMs: rounded(performance.now() - startedAt),
      maskWidth: null,
      maskHeight: null,
      returnedClassId: null,
      foregroundRatio: null,
      nonzeroRatio: null,
      outputSha256: null,
      errorCode: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function toCsv(results) {
  const fields = Object.keys(results[0] ?? {})
  return [fields.join(','), ...results.map((result) => fields.map((field) => csvCell(result[field])).join(','))].join('\n')
}

const manifestBytes = await readFile(manifestPath)
const manifest = JSON.parse(manifestBytes.toString('utf8'))
const selectedItems = manifest.items
  .filter((item) => targetFilter.size === 0 || targetFilter.has(item.target))
  .slice(0, limit)
if (selectedItems.length === 0) throw new Error('没有匹配的评测图片')
await verifyModels(selectedItems)
await mkdir(outputRoot, { recursive: true })
const results = []
for (const item of selectedItems) {
  const result = await evaluateItem(item, sha256(manifestBytes))
  results.push(result)
  process.stdout.write(`${result.imageId}\t${result.status}\t${result.foregroundRatio ?? '-'}\t${result.totalMs}ms\n`)
}
specializedWorker?.close()
const summary = {
  runId,
  outputRoot,
  itemCount: results.length,
  statusCounts: Object.fromEntries(Object.entries(Object.groupBy(results, (result) => result.status)).map(([status, entries]) => [status, entries.length])),
  results,
}
await writeFile(path.join(outputRoot, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`)
await writeFile(path.join(outputRoot, 'results.csv'), `${toCsv(results)}\n`)
process.stdout.write(`results\t${outputRoot}\n`)
