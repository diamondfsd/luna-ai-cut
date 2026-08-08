import { z } from 'zod'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { analyzeAudioBeats, getAudioBeatEvidence } from '../audio-beat-service'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const inspectBeats = defineAiEditingTool({
  id: 'audio.inspect_beats',
  title: '查看音乐节拍',
  description: '读取已分析音乐的 BPM 和节拍时间点。',
  risk: 'read',
  inputSchema: objectSchema({
    mediaId: { type: 'string', description: '音乐素材。' },
    startSeconds: { type: 'number', minimum: 0, description: '可选的起始时间。' },
    endSeconds: { type: 'number', minimum: 0, description: '可选的结束时间。' },
  }, ['mediaId']),
  schema: z.object({
    mediaId: z.string().min(1),
    startSeconds: z.number().min(0).optional(),
    endSeconds: z.number().min(0).optional(),
  }),
  summarize: () => '查看音乐节拍',
  execute: (args) => {
    const evidence = getAudioBeatEvidence(args.mediaId)
    if (!evidence) return { ok: false, message: '这段音乐还没有完成节拍分析。' }
    const beats = evidence.beats
      .filter((beat) => args.startSeconds === undefined || beat >= args.startSeconds)
      .filter((beat) => args.endSeconds === undefined || beat <= args.endSeconds)
      .slice(0, 300)
    return {
      ok: true,
      message: `这段音乐约为 ${Math.round(evidence.tempoBpm)} BPM，共返回 ${beats.length} 个节拍点。`,
      data: { mediaId: evidence.mediaId, tempoBpm: evidence.tempoBpm, beats },
    }
  },
})

const analyzeBeats = defineAiEditingTool({
  id: 'audio.analyze_beats',
  title: '分析音乐节拍',
  description: '使用本地音频分析识别 BPM 和节拍时间点。',
  risk: 'analysis',
  inputSchema: objectSchema({ mediaId: { type: 'string', description: '音乐素材。' } }, ['mediaId']),
  schema: z.object({ mediaId: z.string().min(1) }),
  summarize: () => '分析音乐节拍',
  execute: async (args) => {
    const evidence = await analyzeAudioBeats(args.mediaId)
    return {
      ok: true,
      message: `已识别音乐节拍，速度约为 ${Math.round(evidence.tempoBpm)} BPM。`,
      data: { mediaId: evidence.mediaId, tempoBpm: evidence.tempoBpm, beatCount: evidence.beats.length },
    }
  },
})

function sourceStartSeconds(
  item: { sourceStart?: number; trimStart?: number; offset?: number; sourceFps?: number },
  fallbackFps: number,
): number {
  const sourceFrame = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
  return sourceFrame / (item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fallbackFps)
}

const splitOnBeats = defineAiEditingTool({
  id: 'timeline.split_on_beats',
  title: '按节拍切分片段',
  description: '将指定视频或音频片段切分到音乐的节拍点。音乐必须已完成节拍分析。',
  risk: 'edit',
  inputSchema: objectSchema({
    musicClipId: { type: 'string', description: '时间轴上的音乐片段 ID。' },
    clipIds: { type: 'array', items: { type: 'string' }, description: '需要按节拍切分的时间轴片段 ID。' },
    every: { type: 'number', minimum: 1, maximum: 8, description: '每隔几个节拍切一次，默认每拍。' },
    offsetMilliseconds: { type: 'number', minimum: -300, maximum: 300, description: '相对节拍的微调，默认 0。' },
  }, ['musicClipId', 'clipIds']),
  schema: z.object({
    musicClipId: z.string().min(1),
    clipIds: z.array(z.string()).min(1),
    every: z.number().int().min(1).max(8).optional(),
    offsetMilliseconds: z.number().min(-300).max(300).optional(),
  }),
  summarize: (args) => `按音乐节拍切分 ${args.clipIds.length} 个片段`,
  execute: (args) => {
    const timeline = useTimelineStore.getState()
    const music = timeline.items.find((item) => item.id === args.musicClipId)
    if (!music || (music.type !== 'audio' && music.type !== 'video') || !music.mediaId) {
      return { ok: false, message: '请指定时间轴上的音乐片段。' }
    }
    if (music.isReversed) return { ok: false, message: '暂不支持倒放音乐的节拍切分。' }
    const beatEvidence = getAudioBeatEvidence(music.mediaId)
    if (!beatEvidence) return { ok: false, message: '请先分析这段音乐的节拍。' }

    const fps = timeline.fps > 0 ? timeline.fps : 30
    const sourceStart = sourceStartSeconds(music, fps)
    const speed = music.speed && music.speed > 0 ? music.speed : 1
    const offsetSeconds = (args.offsetMilliseconds ?? 0) / 1_000
    const timelineBeats = beatEvidence.beats
      .filter((_, index) => index % (args.every ?? 1) === 0)
      .map((beat) => music.from / fps + (beat - sourceStart) / speed + offsetSeconds)
      .filter((time) => Number.isFinite(time))

    let splitCount = 0
    for (const clipId of args.clipIds) {
      const clip = timeline.items.find((item) => item.id === clipId)
      if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue
      const frames = timelineBeats
        .map((time) => Math.round(time * fps))
        .filter((frame) => frame > clip.from && frame < clip.from + clip.durationInFrames)
      if (frames.length > 0) splitCount += timeline.splitItemAtFrames(clip.id, frames)
    }
    return {
      ok: splitCount > 0,
      message: splitCount > 0 ? `已在 ${splitCount} 个节拍点切分片段。` : '指定片段内没有可用的节拍点。',
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [inspectBeats, analyzeBeats, splitOnBeats],
}
