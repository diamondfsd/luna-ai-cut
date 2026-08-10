import type { MediaTranscript } from '@freecut/types/storage'

const MAX_TRANSCRIPT_EXCERPT_CHARS = 1_200
const MAX_TRANSCRIPT_EXCERPT_SEGMENTS = 12

export interface TranscriptEvidenceExcerpt {
  startSeconds: number
  endSeconds: number
  text: string
}

function textUnits(text: string): number {
  return text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu)?.length ?? 0
}

/** Counts timed words when available, otherwise counts readable text units. */
export function countTranscriptTextUnits(transcript: MediaTranscript): number {
  return transcript.segments.reduce((count, segment) => {
    if (segment.words && segment.words.length > 0) return count + segment.words.length
    return count + textUnits(segment.text)
  }, 0)
}

/** Keeps a bounded, time-addressable excerpt so the assistant can plan from real speech. */
export function buildTranscriptExcerpt(transcript: MediaTranscript): TranscriptEvidenceExcerpt[] {
  const excerpt: TranscriptEvidenceExcerpt[] = []
  let remainingChars = MAX_TRANSCRIPT_EXCERPT_CHARS

  for (const segment of transcript.segments) {
    if (excerpt.length >= MAX_TRANSCRIPT_EXCERPT_SEGMENTS || remainingChars <= 0) break
    const text = segment.text.trim()
    if (!text) continue
    const clipped = text.slice(0, remainingChars)
    excerpt.push({ startSeconds: segment.start, endSeconds: segment.end, text: clipped })
    remainingChars -= clipped.length
  }

  return excerpt
}

/** Makes phrase lookup tolerant of punctuation and spacing differences. */
export function normalizeTranscriptSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '')
}
