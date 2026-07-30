import assert from 'node:assert/strict'
import { normalizeSubtitleCues, normalizeSubtitleTrack, subtitleTrackToSrt } from '../src/shared/subtitleTrack.ts'
import { buildCompositionFromPreviewLayers } from '../src/components/renderComposition.ts'
import { buildSubtitleLayers } from '../src/workspace/subtitles/subtitleLayers.ts'

const cues = normalizeSubtitleCues([
  { id: 'same', startMs: 2500.4, endMs: 4000.6, text: ' 第二段 ', source: 'generated' },
  { id: 'same', startMs: 1000, endMs: 2200, text: '第一段\n换行', source: 'edited' },
  { id: 'empty', startMs: 0, endMs: 1000, text: ' ' },
  { id: 'bad', startMs: 5000, endMs: 4000, text: '错误' },
], 5000)
assert.deepEqual(cues.map((cue) => cue.id), ['same-2', 'same'])
assert.equal(cues[0].text, '第一段 换行')
assert.equal(cues[1].endMs, 4001)

const track = normalizeSubtitleTrack({
  schemaVersion: 1,
  enabled: true,
  language: 'zh',
  model: { id: 'model', version: '1', sha256: 'a' },
  sourceRange: { startMs: 1500, endMs: 3500 },
  sourceFingerprint: { size: 10, modifiedAtMs: 20 },
  cues,
  generatedAt: '2026-07-30T00:00:00.000Z',
})
assert.ok(track)
assert.equal(subtitleTrackToSrt(track), '1\n00:00:00,000 --> 00:00:00,700\n第一段 换行\n\n2\n00:00:01,000 --> 00:00:02,000\n第二段\n')

const layers = buildSubtitleLayers(track, { width: 1920, height: 1080 }, { startMs: 1500, endMs: 3500 })
assert.equal(layers.length, 4)
assert.deepEqual([layers[0].activeStart, layers[0].activeEnd], [0, 0.7])
assert.deepEqual([layers[2].activeStart, layers[2].activeEnd], [1, 2])
const composition = buildCompositionFromPreviewLayers(layers, 1920, 1080)
assert.deepEqual([composition.layers[2].activeStart, composition.layers[2].activeEnd], [1, 2])

console.log('subtitle track tests passed')
