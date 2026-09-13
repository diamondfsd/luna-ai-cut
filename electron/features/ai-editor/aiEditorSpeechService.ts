import { randomUUID } from 'node:crypto'

import type {
  AiEditorLocalMediaTranscriptionOptions,
  AiEditorLocalMediaTranscriptionResult,
  WorkspaceSubtitleTranscriptionResult,
} from '../../../src/shared/types'
import { probeMedia } from '../../platform/ffmpeg/pipeline'
import { transcribeVideo } from '../subtitles/subtitleTranscriptionService'
import { getAiEditorLocalMedia } from './aiEditorLocalMediaService'
import {
  mergeSpeechChunkCues,
  planSpeechTranscriptionChunks,
  publicSpeechChunk,
  publicSpeechRange,
} from './aiEditorSpeechChunking'

export async function transcribeAiEditorLocalMedia(
  mediaId: string,
  options: AiEditorLocalMediaTranscriptionOptions = {},
): Promise<AiEditorLocalMediaTranscriptionResult> {
  const media = await getAiEditorLocalMedia(mediaId)
  if (media.kind !== 'video') throw new Error('口播字幕识别只支持视频素材')

  const probed = media.duration && media.duration > 0
    ? media.duration
    : (await probeMedia(media.filePath)).durationSeconds
  if (!probed || probed <= 0) throw new Error('无法获取视频时长')

  const plan = planSpeechTranscriptionChunks(probed, options)
  const controller = new AbortController()
  const chunkResults: Array<WorkspaceSubtitleTranscriptionResult | null> = []
  for (const chunk of plan.chunks) {
    controller.signal.throwIfAborted()
    try {
      const result = await transcribeVideo({
        requestId: randomUUID(),
        filePath: media.filePath,
        startMs: chunk.recognitionStartMs,
        endMs: chunk.recognitionEndMs,
        language: 'zh',
      }, controller.signal, () => {})
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
    mediaId: media.mediaId,
    name: media.name,
    durationSec: probed,
    requestedRange: publicSpeechRange(plan.range),
    chunkDurationSec: plan.chunkDurationSec,
    overlapSec: plan.overlapSec,
    chunks: plan.chunks.map(publicSpeechChunk),
  }
}
