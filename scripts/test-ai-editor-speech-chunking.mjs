import assert from 'node:assert/strict'
import {
  DEFAULT_TRANSCRIPTION_CHUNK_DURATION_SEC,
  DEFAULT_TRANSCRIPTION_OVERLAP_SEC,
  mergeSpeechChunkCues,
  planSpeechTranscriptionChunks,
} from '../electron/features/ai-editor/aiEditorSpeechChunking.ts'

const plan = planSpeechTranscriptionChunks(305)
assert.equal(plan.chunkDurationSec, DEFAULT_TRANSCRIPTION_CHUNK_DURATION_SEC)
assert.equal(plan.overlapSec, DEFAULT_TRANSCRIPTION_OVERLAP_SEC)
assert.deepEqual(plan.chunks.map((chunk) => [chunk.startSec, chunk.endSec]), [
  [0, 120],
  [120, 240],
  [240, 305],
])
assert.deepEqual(plan.chunks.map((chunk) => [chunk.recognitionStartSec, chunk.recognitionEndSec]), [
  [0, 121.5],
  [118.5, 241.5],
  [238.5, 305],
])

const cue = (id, startMs, endMs, text) => ({ id, startMs, endMs, text, source: 'generated' })
const merged = mergeSpeechChunkCues(plan.chunks, [
  [
    cue('first', 119_700, 120_700, '边界字幕。'),
    cue('first-unique', 121_000, 122_000, '第一片独有。'),
  ],
  [
    cue('duplicate', 119_800, 120_800, '边界字幕'),
    cue('second-unique', 121_100, 122_100, '第二片独有。'),
    cue('repeated-later', 123_000, 124_000, '边界字幕。'),
  ],
  [],
], plan.range)

assert.deepEqual(merged.map((item) => item.text), [
  '边界字幕',
  '第一片独有。',
  '第二片独有。',
  '边界字幕。',
])
assert.deepEqual(merged.map((item) => [item.startMs, item.endMs]), [
  [119_800, 120_800],
  [121_000, 122_000],
  [121_100, 122_100],
  [123_000, 124_000],
])

const silentFirstChunk = mergeSpeechChunkCues(plan.chunks, [[], [
  cue('second-chunk', 120_100, 121_100, '第二片字幕。'),
]], plan.range)
assert.deepEqual(silentFirstChunk.map((item) => item.text), ['第二片字幕。'])

const partial = planSpeechTranscriptionChunks(100, {
  startSec: 10,
  endSec: 40,
  chunkDurationSec: 20,
  overlapSec: 2,
})
const clipped = mergeSpeechChunkCues(partial.chunks, [[
  cue('outside', 9_000, 11_000, '边界'),
  cue('inside', 20_000, 21_000, '范围内'),
]], partial.range)
assert.deepEqual(clipped.map((item) => [item.startMs, item.endMs]), [
  [10_000, 11_000],
  [20_000, 21_000],
])

assert.throws(() => planSpeechTranscriptionChunks(20, { chunkDurationSec: 20, overlapSec: 10 }))
assert.throws(() => planSpeechTranscriptionChunks(20, { chunkDurationSec: 5 }))
console.log('ai editor speech chunking tests passed')
