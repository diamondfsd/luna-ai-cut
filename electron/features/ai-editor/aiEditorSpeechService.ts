import { randomUUID } from 'node:crypto'

import type {
  AiEditorLocalMediaTranscriptionOptions,
  AiEditorLocalMediaTranscriptionResult,
  WorkspaceSubtitleTranscriptionResult,
} from '../../../src/shared/types'
import { probeMedia } from '../../platform/ffmpeg/pipeline'
import { transcribeAudioSamples as transcribeNativeAudioSamples, transcribeVideo } from '../subtitles/subtitleTranscriptionService'
import { getAiEditorLocalMedia } from './aiEditorLocalMediaService'
import {
  mergeSpeechChunkCues,
  planSpeechTranscriptionChunks,
  publicSpeechChunk,
  publicSpeechRange,
} from './aiEditorSpeechChunking'

interface SpeechSource {
  mediaId: string
  name: string
  filePath?: string
  durationSec?: number
}

interface SpeechChunkResultRunner {
  (chunk: { recognitionStartMs: number; recognitionEndMs: number }, signal: AbortSignal): Promise<WorkspaceSubtitleTranscriptionResult>
}

async function transcribeAiEditorSource(
  source: SpeechSource,
  options: AiEditorLocalMediaTranscriptionOptions = {},
  runner?: SpeechChunkResultRunner,
): Promise<AiEditorLocalMediaTranscriptionResult> {
  const probed = source.durationSec && source.durationSec > 0
    ? source.durationSec
    : source.filePath
      ? (await probeMedia(source.filePath)).durationSeconds
      : 0
  if (!probed || probed <= 0) throw new Error('无法获取视频时长')

  const plan = planSpeechTranscriptionChunks(probed, options)
  const controller = new AbortController()
  const runChunk: SpeechChunkResultRunner = runner ?? (source.filePath
    ? (chunk, signal) => transcribeVideo({
        requestId: randomUUID(),
        filePath: source.filePath!,
        startMs: chunk.recognitionStartMs,
        endMs: chunk.recognitionEndMs,
        language: 'zh',
      }, signal, () => {})
    : () => Promise.reject(new Error(`音频素材 ${source.name} 缺少可读取路径`)))
  const chunkResults: Array<WorkspaceSubtitleTranscriptionResult | null> = []
  for (const chunk of plan.chunks) {
    controller.signal.throwIfAborted()
    try {
      const result = await runChunk(chunk, controller.signal)
      chunk.cueCount = result.cues.length
      chunkResults.push(result)
    } catch (error) {
      // A silent chunk is normal in a long recording. Keep processing later chunks;
      // the all-silent case is reported after the merge below.
      if (error instanceof Error && error.message === '没有识别到可用语音') {
        chunk.cueCount = 0
        chunkResults.push(null)
        continue
      }
      throw error
    }
  }

  const completedResults = chunkResults.filter((result): result is WorkspaceSubtitleTranscriptionResult => result !== null)
  const firstResult = completedResults[0]
  if (!firstResult) throw new Error('没有识别到可用语音')
  const cues = mergeSpeechChunkCues(
    plan.chunks,
    chunkResults.map((result) => result?.cues ?? []),
    plan.range,
  )
  if (cues.length === 0) throw new Error('没有识别到可用语音')

  const performance = {
    modelLoadMs: completedResults.reduce((total, result) => total + result.performance.modelLoadMs, 0),
    inferenceMs: completedResults.reduce((total, result) => total + result.performance.inferenceMs, 0),
    audioMs: completedResults.reduce((total, result) => total + result.performance.audioMs, 0),
    totalMs: completedResults.reduce((total, result) => total + result.performance.totalMs, 0),
  }

  return {
    ...firstResult,
    requestId: randomUUID(),
    cues,
    performance,
    mediaId: source.mediaId,
    name: source.name,
    durationSec: probed,
    requestedRange: publicSpeechRange(plan.range),
    chunkDurationSec: plan.chunkDurationSec,
    overlapSec: plan.overlapSec,
    chunks: plan.chunks.map(publicSpeechChunk),
  }
}

export async function transcribeAiEditorLocalMedia(
  mediaId: string,
  options: AiEditorLocalMediaTranscriptionOptions = {},
): Promise<AiEditorLocalMediaTranscriptionResult> {
  const media = await getAiEditorLocalMedia(mediaId)
  if (media.kind !== 'video') throw new Error('口播字幕识别只支持视频素材')
  return transcribeAiEditorSource({
    mediaId: media.mediaId,
    name: media.name,
    filePath: media.filePath,
    durationSec: media.duration,
  }, options)
}

export async function transcribeAiEditorAudioSamples(
  samples: Float32Array,
  options: AiEditorLocalMediaTranscriptionOptions = {},
): Promise<AiEditorLocalMediaTranscriptionResult> {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error('没有可识别的音频数据')
  }
  const durationSec = samples.length / 16_000
  return transcribeAiEditorSource(
    {
      mediaId: 'luna:audio-samples',
      name: 'Luna audio samples',
      durationSec,
    },
    options,
    (chunk, signal) => transcribeNativeAudioSamples({
      requestId: randomUUID(),
      samples,
      startMs: chunk.recognitionStartMs,
      endMs: chunk.recognitionEndMs,
      language: 'zh',
    }, signal, () => {}),
  )
}
