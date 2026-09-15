import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkspaceSubtitleProgress, WorkspaceSubtitleTranscriptionRequest, WorkspaceSubtitleTranscriptionResult } from '../../../src/shared/types'
import { SUBTITLE_ASR_MODEL } from '../../../src/shared/subtitleModels'
import { segmentSubtitleUnits, subtitleUnitsFromCues } from '../../../src/shared/subtitleSegmentation'
import { getFfmpegPath } from '../../platform/ffmpeg/pipeline'
import { loadSubtitleModels } from './subtitleModelService'
import { restoreSubtitlePunctuation } from './subtitlePunctuationService'
import { normalizeSubtitleCuesLanguage, parseSubtitleWorkerEvent, subtitleCuesFromWorker } from './subtitleWorkerProtocol'

function appRoot(): string {
  return process.env.APP_ROOT ?? path.join(import.meta.dirname, '..')
}

function asrWorkerPath(): string {
  const name = process.platform === 'win32' ? 'luna-asr-worker.exe' : 'luna-asr-worker'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'luna-render-core', name)
    : path.join(appRoot(), 'luna-render-core', name)
}

function asrThreads(): number {
  return Math.max(2, Math.min(8, cpus().length - 2))
}

function terminate(child: ChildProcess | null): void {
  if (!child || child.killed) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 1_500)
  timer.unref()
}

function waitForClose(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
}

function validateRequest(request: WorkspaceSubtitleTranscriptionRequest): void {
  if (!request.requestId || !request.filePath) throw new Error('字幕识别任务无效')
  if (!Number.isFinite(request.startMs) || !Number.isFinite(request.endMs) || request.startMs < 0 || request.endMs <= request.startMs) {
    throw new Error('字幕识别范围无效')
  }
  if (request.endMs - request.startMs > 12 * 60 * 60 * 1_000) throw new Error('单次最多识别 12 小时视频')
  if (!['auto', 'zh', 'en'].includes(request.language)) throw new Error('字幕识别语言无效')
}

export async function transcribeVideo(
  request: WorkspaceSubtitleTranscriptionRequest,
  signal: AbortSignal,
  onProgress: (progress: WorkspaceSubtitleProgress) => void,
): Promise<WorkspaceSubtitleTranscriptionResult> {
  validateRequest(request)
  const sourceBefore = await stat(request.filePath)
  if (!sourceBefore.isFile()) throw new Error('视频文件无效')
  const startedAt = performance.now()
  onProgress({ requestId: request.requestId, phase: 'model', label: '正在准备字幕识别', percent: null })
  const models = await loadSubtitleModels(signal, ({ completedBytes, totalBytes }) => {
    onProgress({
      requestId: request.requestId,
      phase: 'model',
      label: '正在下载字幕识别模型',
      percent: totalBytes > 0 ? Math.round(completedBytes / totalBytes * 100) : null,
    })
  })
  signal.throwIfAborted()
  onProgress({ requestId: request.requestId, phase: 'preparing', label: '正在读取视频语音', percent: 0 })

  const totalMs = Math.round(request.endMs - request.startMs)
  const worker = spawn(asrWorkerPath(), [
    models.asr,
    models.tokens,
    models.vad,
    request.language,
    String(asrThreads()),
    String(Math.round(request.startMs)),
    String(totalMs),
    process.platform === 'darwin' ? 'gpu' : 'cpu',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  const ffmpeg = spawn(getFfmpegPath(), [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-ss', (request.startMs / 1_000).toFixed(3),
    '-i', request.filePath,
    '-t', (totalMs / 1_000).toFixed(3),
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
    '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let ffmpegError = ''
  let workerError = ''
  let modelLoadMs = 0
  const workerState: { completed: { language: string; audioMs: number; inferenceMs: number } | null; protocolError: Error | null } = {
    completed: null,
    protocolError: null,
  }
  const cues: WorkspaceSubtitleTranscriptionResult['cues'] = []
  ffmpeg.stderr.setEncoding('utf8')
  worker.stderr.setEncoding('utf8')
  worker.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') workerError = `${workerError}${error.message}`.slice(-16_384)
  })
  ffmpeg.stderr.on('data', (chunk: string) => { ffmpegError = `${ffmpegError}${chunk}`.slice(-16_384) })
  worker.stderr.on('data', (chunk: string) => { workerError = `${workerError}${chunk}`.slice(-16_384) })
  ffmpeg.stdout.pipe(worker.stdin)

  const ffmpegDone = waitForClose(ffmpeg)
  const workerDone = waitForClose(worker)
  void ffmpegDone.then((code) => {
    if (code !== 0 && worker.exitCode === null) terminate(worker)
  }, () => {})
  void workerDone.then((code) => {
    if (code !== 0 && ffmpeg.exitCode === null) terminate(ffmpeg)
  }, () => {})

  const abort = (): void => {
    ffmpeg.stdout.unpipe(worker.stdin)
    terminate(ffmpeg)
    terminate(worker)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    let lineBuffer = ''
    const processLine = (line: string): void => {
      if (!line.trim()) return
      let event: ReturnType<typeof parseSubtitleWorkerEvent>
      try {
        event = parseSubtitleWorkerEvent(line)
      } catch (error) {
        workerState.protocolError = error instanceof Error ? error : new Error(String(error))
        return
      }
      if (event.type === 'ready') {
        modelLoadMs = event.modelLoadMs
        onProgress({ requestId: request.requestId, phase: 'recognizing', label: '正在识别字幕', percent: 0 })
      } else if (event.type === 'progress') {
        onProgress({
          requestId: request.requestId,
          phase: 'recognizing',
          label: '正在识别字幕',
          percent: event.totalMs > 0 ? Math.min(99, Math.round(event.processedMs / event.totalMs * 100)) : null,
        })
      } else if (event.type === 'segment') {
        cues.push(...subtitleCuesFromWorker(event))
      } else {
        workerState.completed = event
      }
    }
    worker.stdout.setEncoding('utf8')
    worker.stdout.on('data', (chunk: string) => {
      lineBuffer += chunk
      for (;;) {
        const newline = lineBuffer.indexOf('\n')
        if (newline < 0) break
        processLine(lineBuffer.slice(0, newline))
        lineBuffer = lineBuffer.slice(newline + 1)
      }
    })
    worker.stdout.on('end', () => processLine(lineBuffer))

    const [ffmpegCode, workerCode] = await Promise.all([ffmpegDone, workerDone])
    signal.throwIfAborted()
    if (ffmpegCode !== 0) throw new Error(ffmpegError.trim() || '无法读取视频语音')
    if (workerState.protocolError) throw workerState.protocolError
    const completed = workerState.completed
    if (workerCode !== 0 || !completed) throw new Error(workerError.trim() || '字幕识别未完成')
    onProgress({ requestId: request.requestId, phase: 'recognizing', label: '正在整理字幕分段', percent: 99 })
    const normalizedCues = normalizeSubtitleCuesLanguage(cues, completed.language)
    const units = subtitleUnitsFromCues(normalizedCues)
    const punctuation = await restoreSubtitlePunctuation(units, models.punctuation, signal)
    const segmentedCues = segmentSubtitleUnits(units, punctuation.punctuations)
    if (segmentedCues.length === 0) throw new Error('没有识别到可用语音')
    const sourceAfter = await stat(request.filePath)
    if (sourceAfter.size !== sourceBefore.size || sourceAfter.mtimeMs !== sourceBefore.mtimeMs) {
      throw new Error('识别期间视频文件发生变化，请重新生成字幕')
    }
    onProgress({ requestId: request.requestId, phase: 'recognizing', label: '字幕识别完成', percent: 100 })
    return {
      requestId: request.requestId,
      language: completed.language,
      cues: segmentedCues,
      model: { id: SUBTITLE_ASR_MODEL.id, version: SUBTITLE_ASR_MODEL.version, sha256: SUBTITLE_ASR_MODEL.sha256 },
      sourceFingerprint: { size: sourceAfter.size, modifiedAtMs: sourceAfter.mtimeMs },
      performance: {
        modelLoadMs: modelLoadMs + punctuation.modelLoadMs,
        inferenceMs: completed.inferenceMs + punctuation.inferenceMs,
        audioMs: completed.audioMs,
        totalMs: Math.round(performance.now() - startedAt),
      },
    }
  } finally {
    signal.removeEventListener('abort', abort)
    if (ffmpeg.exitCode === null) terminate(ffmpeg)
    if (worker.exitCode === null) terminate(worker)
  }
}

function wavFileFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const wav = Buffer.alloc(44 + data.byteLength)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + data.byteLength, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(3, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 4, 28)
  wav.writeUInt16LE(4, 32)
  wav.writeUInt16LE(32, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(data.byteLength, 40)
  data.copy(wav, 44)
  return wav
}

/** Run the native Sherpa pipeline on audio already decoded by the embedded editor. */
export async function transcribeAudioSamples(
  request: Omit<WorkspaceSubtitleTranscriptionRequest, 'filePath'> & { samples: Float32Array },
  signal: AbortSignal,
  onProgress: (progress: WorkspaceSubtitleProgress) => void,
): Promise<WorkspaceSubtitleTranscriptionResult> {
  if (!(request.samples instanceof Float32Array) || request.samples.length === 0) {
    throw new Error('没有可识别的音频数据')
  }
  const sampleRate = 16_000
  const tempDir = path.join(app.getPath('temp'), 'luna-sherpa')
  const filePath = path.join(tempDir, `audio-${randomUUID()}.wav`)
  await mkdir(tempDir, { recursive: true })
  await writeFile(filePath, wavFileFromFloat32(request.samples, sampleRate), { mode: 0o600 })
  try {
    return await transcribeVideo({
      requestId: request.requestId,
      filePath,
      startMs: request.startMs,
      endMs: request.endMs,
      language: request.language,
    }, signal, onProgress)
  } finally {
    await rm(filePath, { force: true }).catch(() => undefined)
  }
}
