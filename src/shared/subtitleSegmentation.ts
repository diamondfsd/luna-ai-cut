import type { WorkspaceSubtitleCue } from './types/subtitles'

export interface TimedSubtitleUnit {
  text: string
  startMs: number
  endMs: number
  wordBoundaryAfter?: boolean
}

const TOKEN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{Script=Latin}\p{N}]+(?:['’-][\p{Script=Latin}\p{N}]+)*|[\p{L}\p{N}]/gu
const STRONG_PUNCTUATION = /[。！？.!?]/u
const WEAK_PUNCTUATION = /[，、,;；:：]/u
const LATIN_WORD = /^[\p{Script=Latin}\p{N}]/u
const UNNATURAL_START = /^[的了着和但因所而或也就都又]/u
const UNNATURAL_END = /[的了着和但因所而或也就都又]$/u
const IDEAL_WIDTH = 14
const MAX_WIDTH = 20
const MAX_DURATION_MS = 5_000

function displayWidth(unit: TimedSubtitleUnit): number {
  return Math.max(1, [...unit.text].length)
}

function rangeWidth(units: TimedSubtitleUnit[], start: number, end: number): number {
  return units.slice(start, end).reduce((total, unit) => total + displayWidth(unit), 0)
}

function rangeDuration(units: TimedSubtitleUnit[], start: number, end: number): number {
  return Math.max(0, units[end - 1].endMs - units[start].startMs)
}

function tokenize(text: string): string[] {
  return text.normalize('NFKC').match(TOKEN_PATTERN) ?? []
}

function markWordBoundaries(units: TimedSubtitleUnit[]): void {
  interface WordSegment {
    segment: string
    index: number
  }
  interface WordSegmenter {
    segment(input: string): Iterable<WordSegment>
  }
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locale: string, options: { granularity: 'word' }) => WordSegmenter
  }).Segmenter
  if (!Segmenter) {
    for (const unit of units) unit.wordBoundaryAfter = true
    return
  }
  let analysisText = ''
  const endOffsets: number[] = []
  for (let index = 0; index < units.length; index += 1) {
    const previous = units[index - 1]?.text
    if (previous && LATIN_WORD.test(previous) && LATIN_WORD.test(units[index].text)) analysisText += ' '
    analysisText += units[index].text
    endOffsets.push(analysisText.length)
  }
  const boundaries = new Set([...new Segmenter('zh-CN', { granularity: 'word' }).segment(analysisText)]
    .filter((item) => item.segment.trim())
    .map((item) => item.index + item.segment.length))
  for (let index = 0; index < units.length; index += 1) units[index].wordBoundaryAfter = boundaries.has(endOffsets[index])
}

export function subtitleUnitsFromCues(cues: WorkspaceSubtitleCue[]): TimedSubtitleUnit[] {
  const units: TimedSubtitleUnit[] = []
  for (const cue of [...cues].sort((left, right) => left.startMs - right.startMs)) {
    const tokens = tokenize(cue.text)
    if (tokens.length === 0) continue
    const duration = Math.max(tokens.length * 10, cue.endMs - cue.startMs)
    const totalWeight = tokens.reduce((total, token) => total + Math.max(1, [...token].length), 0)
    let elapsedWeight = 0
    for (const token of tokens) {
      const startMs = cue.startMs + duration * elapsedWeight / totalWeight
      elapsedWeight += Math.max(1, [...token].length)
      const endMs = cue.startMs + duration * elapsedWeight / totalWeight
      units.push({ text: token, startMs: Math.round(startMs), endMs: Math.round(endMs) })
    }
  }
  markWordBoundaries(units)
  return units
}

function punctuationAt(punctuations: readonly string[], index: number): string {
  const punctuation = punctuations[index] ?? '_'
  return punctuation === '_' ? '' : punctuation
}

function selectSplit(units: TimedSubtitleUnit[], punctuations: readonly string[], start: number, end: number): number {
  let best = Math.min(start + 1, end)
  let bestScore = Number.NEGATIVE_INFINITY
  for (let cut = start + 1; cut < end; cut += 1) {
    const width = rangeWidth(units, start, cut)
    const duration = rangeDuration(units, start, cut)
    if (width > MAX_WIDTH || duration > MAX_DURATION_MS) break
    const remainingWidth = rangeWidth(units, cut, end)
    const punctuation = punctuationAt(punctuations, cut - 1)
    const gap = Math.max(0, units[cut].startMs - units[cut - 1].endMs)
    let score = -Math.abs(IDEAL_WIDTH - width)
    if (width < 8) score -= 20
    if (remainingWidth > 0 && remainingWidth < 6) score -= 24
    if (WEAK_PUNCTUATION.test(punctuation)) score += 18
    if (STRONG_PUNCTUATION.test(punctuation)) score += 40
    score += Math.min(20, gap / 25)
    score += units[cut - 1].wordBoundaryAfter ? 12 : -30
    if (UNNATURAL_START.test(units[cut].text)) score -= 30
    if (UNNATURAL_END.test(units[cut - 1].text)) score -= 30
    if (score > bestScore) {
      best = cut
      bestScore = score
    }
  }
  return best
}

function splitChunk(units: TimedSubtitleUnit[], punctuations: readonly string[], start: number, end: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let cursor = start
  while (cursor < end) {
    if (rangeWidth(units, cursor, end) <= MAX_WIDTH && rangeDuration(units, cursor, end) <= MAX_DURATION_MS) {
      ranges.push([cursor, end])
      break
    }
    const split = selectSplit(units, punctuations, cursor, end)
    ranges.push([cursor, split])
    cursor = split
  }
  return ranges
}

function cueText(units: TimedSubtitleUnit[], punctuations: readonly string[], start: number, end: number): string {
  let result = ''
  for (let index = start; index < end; index += 1) {
    const token = units[index].text
    const previous = units[index - 1]?.text
    if (result && LATIN_WORD.test(token) && previous && LATIN_WORD.test(previous)) result += ' '
    result += token + punctuationAt(punctuations, index)
  }
  return result.trim().replace(/\p{P}+$/gu, (marks) => [...marks]
    .filter((mark) => mark === '?' || mark === '？')
    .join('')).trimEnd()
}

export function segmentSubtitleUnits(
  units: TimedSubtitleUnit[],
  punctuations: readonly string[],
): WorkspaceSubtitleCue[] {
  if (punctuations.length !== units.length) throw new Error('标点结果与字幕文字不匹配')
  const chunks: Array<[number, number]> = []
  let chunkStart = 0
  for (let index = 0; index < units.length; index += 1) {
    const punctuation = punctuationAt(punctuations, index)
    const nextGap = index + 1 < units.length ? units[index + 1].startMs - units[index].endMs : 0
    if (STRONG_PUNCTUATION.test(punctuation) || nextGap >= 700 || index === units.length - 1) {
      chunks.push([chunkStart, index + 1])
      chunkStart = index + 1
    }
  }
  return chunks.flatMap(([start, end]) => splitChunk(units, punctuations, start, end)).map(([start, end], index) => ({
    id: `generated-subtitle-${units[start].startMs}-${index + 1}`,
    startMs: Math.max(0, Math.round(units[start].startMs)),
    endMs: Math.max(Math.round(units[start].startMs) + 10, Math.round(units[end - 1].endMs)),
    text: cueText(units, punctuations, start, end),
    source: 'generated',
  }))
}
