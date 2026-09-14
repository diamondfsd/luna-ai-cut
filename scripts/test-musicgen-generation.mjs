#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const modelId = 'musicgen-small-onnx'
const modelFiles = [
  'config.json',
  'tokenizer.json',
  'text_encoder.onnx',
  'decoder_model_merged.onnx',
  'encodec_decode.onnx',
]
const defaultDurationSec = 30
const defaultTimeoutSec = 20 * 60

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredNumber(name, fallback, minimum, maximum) {
  const value = argument(name)
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${name} 必须是 ${minimum}-${maximum} 之间的数字`)
  }
  return number
}

function defaultWorkerPath() {
  const name = process.platform === 'win32' ? 'musicgen-worker.exe' : 'musicgen-worker'
  const candidates = [
    process.env.LUNA_MUSICGEN_WORKER,
    path.join(projectRoot, 'luna-render-core', name),
    path.join(projectRoot, 'luna-render-core', 'target', 'release', name),
    path.join(projectRoot, 'luna-render-core', 'target', 'debug', name),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

function defaultModelDirectory() {
  const configRoot = process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', 'luna-ai-cut')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'luna-ai-cut')
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'luna-ai-cut')
  return path.join(configRoot, 'models', modelId)
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function inspectWav(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('输出文件不是有效的 WAV')
  }

  let offset = 12
  let format = null
  let dataBytes = null
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize
    if (chunkEnd > buffer.length) throw new Error(`WAV ${chunkId} 区块超出文件范围`)
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    }
    if (chunkId === 'data') dataBytes = chunkSize
    offset = chunkEnd + (chunkSize % 2)
  }
  if (!format || dataBytes === null) throw new Error('WAV 缺少 fmt 或 data 区块')
  const blockAlign = format.channels * format.bitsPerSample / 8
  if (!Number.isInteger(blockAlign) || blockAlign <= 0) throw new Error('WAV 帧格式无效')
  return {
    ...format,
    dataBytes,
    durationSec: dataBytes / blockAlign / format.sampleRate,
  }
}

async function assertModelDirectory(modelDirectory) {
  const missing = []
  for (const fileName of modelFiles) {
    if (!existsSync(path.join(modelDirectory, fileName))) missing.push(fileName)
  }
  if (missing.length > 0) {
    throw new Error(`本地 MusicGen 模型不完整：${missing.join(', ')}\n模型目录：${modelDirectory}`)
  }
}

function runHealthCheck(workerPath) {
  const result = spawnSync(workerPath, ['--health-check'], { encoding: 'utf8' })
  if (result.error) throw new Error(`无法启动 MusicGen worker：${result.error.message}`)
  if (result.status !== 0) throw new Error(`MusicGen worker 健康检查失败：${(result.stderr || '').trim()}`)
}

async function generate({ workerPath, modelDirectory, outputPath, durationSec, timeoutSec }) {
  await mkdir(path.dirname(outputPath), { recursive: true })
  const requestId = `musicgen-test-${Date.now()}`
  const child = spawn(workerPath, ['--serve', modelDirectory], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let ready = false
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error(`MusicGen 生成超时（${timeoutSec} 秒）`))
    }, timeoutSec * 1_000)

    const terminate = () => {
      if (child.exitCode !== null || child.killed) return
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
      }, 1_500).unref()
    }
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) terminate()
      else child.stdin.end()
      error ? reject(error) : resolve(result)
    }
    const handleLine = (line) => {
      const event = parseJsonLine(line.trim())
      if (!event) return
      if (event.type === 'ready') {
        ready = true
        child.stdin.write(`${JSON.stringify({
          type: 'generate',
          requestId,
          prompt: '轻快、明亮、适合旅行短片的纯音乐背景配乐，无歌词、无人声、中等节奏、适合循环',
          durationSec,
          outputPath,
        })}\n`)
        return
      }
      if (event.type === 'progress' && event.requestId === requestId) {
        const percent = event.totalTokens > 0 ? Math.round(event.generatedTokens / event.totalTokens * 100) : 0
        process.stdout.write(`\r生成进度：${percent}%`)
        return
      }
      if (event.type === 'complete' && event.requestId === requestId) {
        process.stdout.write('\n')
        finish(null, event)
        return
      }
      if (event.type === 'error' && (!event.requestId || event.requestId === requestId)) {
        finish(new Error(event.error || 'MusicGen 生成失败'))
      }
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      for (;;) {
        const newline = stdout.indexOf('\n')
        if (newline < 0) break
        handleLine(stdout.slice(0, newline))
        stdout = stdout.slice(newline + 1)
      }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => finish(new Error(`MusicGen worker 启动失败：${error.message}`)))
    child.once('close', (code, signal) => {
      if (settled) return
      const detail = stderr.trim() || `worker 退出（${code ?? signal ?? '未知原因'}）`
      finish(new Error(ready ? `MusicGen 生成失败：${detail}` : `MusicGen 模型加载失败：${detail}`))
    })
    process.once('SIGINT', () => finish(new Error('已取消 MusicGen 测试')))
  })
}

async function main() {
  const workerPath = path.resolve(argument('--worker') ?? defaultWorkerPath())
  const modelDirectory = path.resolve(argument('--model-dir') ?? process.env.LUNA_MUSICGEN_MODEL_DIR ?? defaultModelDirectory())
  const durationSec = requiredNumber('--duration-sec', defaultDurationSec, 1, 30)
  const timeoutSec = requiredNumber('--timeout-sec', defaultTimeoutSec, 30, 3_600)
  const outputPath = path.resolve(argument('--output') ?? path.join(tmpdir(), `luna-musicgen-test-${Date.now()}.wav`))

  if (!existsSync(workerPath)) throw new Error(`找不到 MusicGen worker：${workerPath}\n请先构建 musicgen-worker，或通过 --worker 指定路径`)
  await assertModelDirectory(modelDirectory)
  runHealthCheck(workerPath)
  console.log(`worker：${workerPath}`)
  console.log(`模型：${modelDirectory}`)
  console.log(`目标时长：${durationSec} 秒`)
  console.log(`输出：${outputPath}`)

  const event = await generate({ workerPath, modelDirectory, outputPath, durationSec, timeoutSec })
  const info = await stat(outputPath)
  const wav = inspectWav(await readFile(outputPath))
  const toleranceSec = 0.25
  if (Math.abs(wav.durationSec - durationSec) > toleranceSec) {
    throw new Error(`WAV 实际时长异常：${wav.durationSec.toFixed(3)} 秒，目标 ${durationSec} 秒`)
  }
  if (wav.audioFormat !== 3 || wav.channels !== 1 || wav.bitsPerSample !== 32) {
    throw new Error(`WAV 格式异常：format=${wav.audioFormat}, channels=${wav.channels}, bits=${wav.bitsPerSample}`)
  }
  console.log(`生成完成：${wav.durationSec.toFixed(3)} 秒，${wav.sampleRate} Hz，${wav.channels} 声道，${wav.bitsPerSample} bit，${info.size} bytes`)
  console.log(`推理耗时：${event.inferenceMs} ms`)
  console.log(`通过：30 秒 MusicGen 本地生成测试`)
}

try {
  await main()
} catch (error) {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
