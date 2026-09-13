import type {
  AiEditorLocalMediaTranscriptionChunk,
  AiEditorLocalMediaTranscriptionRange,
  WorkspaceSubtitleCue,
} from '../../../src/shared/types'

export const DEFAULT_TRANSCRIPTION_CHUNK_DURATION_SEC = 120
export const DEFAULT_TRANSCRIPTION_OVERLAP_SEC = 1.5
export const MIN_TRANSCRIPTION_CHUNK_DURATION_SEC = 10
export const MAX_TRANSCRIPTION_CHUNK_DURATION_SEC = 15 * 60
export const MAX_TRANSCRIPTION_OVERLAP_SEC = 30

export interface SpeechChunkWindow extends AiEditorLocalMediaTranscriptionChunk {
  startMs: number
  endMs: number
  recognitionStartMs: number
  recognitionEndMs: number
}

export interface SpeechChunkPlan {
  durationMs: number
  range: {
    startMs: number
    endMs: number
  }
  chunkDurationSec: number
  overlapSec: number
  chunks: SpeechChunkWindow[]
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是有效数字`)
  return value
}

function secondsToMs(value: number): number {
  return Math.round(value * 1_000)
}

function msToSeconds(value: number): number {
  return Number((value / 1_000).toFixed(3))
}

export function planSpeechTranscriptionChunks(
  durationSec: number,
  options: {
    startSec?: number
    endSec?: number
    chunkDurationSec?: number
    overlapSec?: number
  } = {},
): SpeechChunkPlan {
  const duration = finiteNumber(durationSec, '视频时长')
  if (duration <= 0) throw new Error('视频时长无效')
  const durationMs = Math.max(1, secondsToMs(duration))

  const startSec = options.startSec === undefined ? 0 : finiteNumber(options.startSec, '起始时间')
  const endSec = options.endSec === undefined ? duration : finiteNumber(options.endSec, '结束时间')
  if (startSec < 0 || startSec >= duration) throw new Error('起始时间超出视频范围')
  if (endSec <= startSec) throw new Error('结束时间必须晚于起始时间')
  const rangeStartMs = Math.max(0, secondsToMs(startSec))
  const rangeEndMs = Math.min(durationMs, Math.max(rangeStartMs + 1, secondsToMs(endSec)))
  if (rangeEndMs <= rangeStartMs) throw new Error('识别范围超出视频范围')

  const chunkDurationSec = options.chunkDurationSec === undefined
    ? DEFAULT_TRANSCRIPTION_CHUNK_DURATION_SEC
    : finiteNumber(options.chunkDurationSec, '分片时长')
  if (chunkDurationSec < MIN_TRANSCRIPTION_CHUNK_DURATION_SEC || chunkDurationSec > MAX_TRANSCRIPTION_CHUNK_DURATION_SEC) {
    throw new Error(`分片时长需在 ${MIN_TRANSCRIPTION_CHUNK_DURATION_SEC}-${MAX_TRANSCRIPTION_CHUNK_DURATION_SEC} 秒之间`)
  }
  const overlapSec = options.overlapSec === undefined
    ? DEFAULT_TRANSCRIPTION_OVERLAP_SEC
    : finiteNumber(options.overlapSec, '分片补偿时长')
  if (overlapSec < 0 || overlapSec > MAX_TRANSCRIPTION_OVERLAP_SEC) {
    throw new Error(`分片补偿时长需在 0-${MAX_TRANSCRIPTION_OVERLAP_SEC} 秒之间`)
  }
  if (overlapSec * 2 >= chunkDurationSec) throw new Error('分片补偿时长必须小于分片时长的一半')

  const chunkDurationMs = Math.max(1, secondsToMs(chunkDurationSec))
  const overlapMs = Math.max(0, secondsToMs(overlapSec))
  const chunks: SpeechChunkWindow[] = []
  for (let startMs = rangeStartMs, index = 0; startMs < rangeEndMs; startMs += chunkDurationMs, index += 1) {
    const endMs = Math.min(rangeEndMs, startMs + chunkDurationMs)
    const recognitionStartMs = Math.max(0, startMs - overlapMs)
    const recognitionEndMs = Math.min(durationMs, endMs + overlapMs)
    chunks.push({
      index,
      startMs,
      endMs,
      recognitionStartMs,
      recognitionEndMs,
      startSec: msToSeconds(startMs),
      endSec: msToSeconds(endMs),
      recognitionStartSec: msToSeconds(recognitionStartMs),
      recognitionEndSec: msToSeconds(recognitionEndMs),
      cueCount: 0,
    })
  }

  return {
    durationMs,
    range: { startMs: rangeStartMs, endMs: rangeEndMs },
    chunkDurationSec,
    overlapSec,
    chunks,
  }
}

interface ChunkCue {
  chunkIndex: number
  cue: WorkspaceSubtitleCue
}

function canonicalCueText(text: string): string {
  return text.normalize('NFKC').replace(/[\s，。！？；：、,.!?;:]/g, '').trim()
}

function temporalOverlap(left: WorkspaceSubtitleCue, right: WorkspaceSubtitleCue): number {
  return Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs))
}

function sameOverlappingCue(left: WorkspaceSubtitleCue, right: WorkspaceSubtitleCue): boolean {
  if (canonicalCueText(left.text) !== canonicalCueText(right.text)) return false
  const overlap = temporalOverlap(left, right)
  if (overlap > 0) {
    const shorter = Math.max(1, Math.min(left.endMs - left.startMs, right.endMs - right.startMs))
    return overlap / shorter >= 0.25
  }
  return Math.abs(left.startMs - right.startMs) <= 500 && Math.abs(left.endMs - right.endMs) <= 500
}

function chunkForCue(cue: WorkspaceSubtitleCue, chunks: readonly SpeechChunkWindow[]): SpeechChunkWindow | null {
  const midpoint = (cue.startMs + cue.endMs) / 2
  return chunks.find((chunk) => midpoint >= chunk.startMs && midpoint < chunk.endMs)
    ?? chunks.reduce<SpeechChunkWindow | null>((nearest, chunk) => {
      if (!nearest) return chunk
      const nearestDistance = midpoint < nearest.startMs
        ? nearest.startMs - midpoint
        : midpoint > nearest.endMs
          ? midpoint - nearest.endMs
          : 0
      const distance = midpoint < chunk.startMs
        ? chunk.startMs - midpoint
        : midpoint > chunk.endMs
          ? midpoint - chunk.endMs
          : 0
      return distance < nearestDistance ? chunk : nearest
    }, null)
}

function candidateScore(candidate: ChunkCue, chunks: readonly SpeechChunkWindow[]): number {
  const chunk = chunks[candidate.chunkIndex]
  if (!chunk) return Number.MAX_SAFE_INTEGER
  const owner = chunkForCue(candidate.cue, chunks)
  const ownershipPenalty = owner?.index === chunk.index ? 0 : 1_000_000
  const midpoint = (candidate.cue.startMs + candidate.cue.endMs) / 2
  const centerDistance = Math.abs(midpoint - (chunk.startMs + chunk.endMs) / 2)
  return ownershipPenalty + centerDistance
}

/**
 * Keep one cue from overlapping recognition windows and preserve original timestamps.
 * The logical chunk owning a cue wins over a cue found only in its context padding.
 */
export function mergeSpeechChunkCues(
  chunks: readonly SpeechChunkWindow[],
  cuesByChunk: readonly (readonly WorkspaceSubtitleCue[])[],
  range: { startMs: number; endMs: number },
): WorkspaceSubtitleCue[] {
  const candidates: ChunkCue[] = []
  for (const [chunkIndex, cues] of cuesByChunk.entries()) {
    for (const cue of cues) {
      if (cue.endMs <= range.startMs || cue.startMs >= range.endMs || cue.endMs <= cue.startMs || !cue.text.trim()) continue
      candidates.push({
        chunkIndex,
        cue: {
          ...cue,
          startMs: Math.max(range.startMs, cue.startMs),
          endMs: Math.min(range.endMs, cue.endMs),
        },
      })
    }
  }
  candidates.sort((left, right) => left.cue.startMs - right.cue.startMs || left.cue.endMs - right.cue.endMs)

  const merged: ChunkCue[] = []
  for (const candidate of candidates) {
    const duplicateIndex = merged.findIndex((existing) => sameOverlappingCue(existing.cue, candidate.cue))
    if (duplicateIndex < 0) {
      merged.push(candidate)
      continue
    }
    if (candidateScore(candidate, chunks) < candidateScore(merged[duplicateIndex], chunks)) {
      merged[duplicateIndex] = candidate
    }
  }

  return merged
    .sort((left, right) => left.cue.startMs - right.cue.startMs || left.cue.endMs - right.cue.endMs)
    .map(({ cue }) => cue)
}

export function publicSpeechChunk(chunk: SpeechChunkWindow): AiEditorLocalMediaTranscriptionChunk {
  return {
    index: chunk.index,
    startSec: chunk.startSec,
    endSec: chunk.endSec,
    recognitionStartSec: chunk.recognitionStartSec,
    recognitionEndSec: chunk.recognitionEndSec,
    cueCount: chunk.cueCount,
  }
}

export function publicSpeechRange(range: { startMs: number; endMs: number }): AiEditorLocalMediaTranscriptionRange {
  return { startSec: msToSeconds(range.startMs), endSec: msToSeconds(range.endMs) }
}
