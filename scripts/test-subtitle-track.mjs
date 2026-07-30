import assert from 'node:assert/strict'
import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleCues, normalizeSubtitleTrack, subtitleTrackToSrt } from '../src/shared/subtitleTrack.ts'
import { buildCompositionFromPreviewLayers } from '../src/components/renderComposition.ts'
import { buildSubtitleLayers, wrapSubtitleText } from '../src/workspace/subtitles/subtitleLayers.ts'

const cues = normalizeSubtitleCues([
  { id: 'same', startMs: 2500.4, endMs: 4000.6, text: ' 第二段 ', source: 'generated' },
  { id: 'same', startMs: 1000, endMs: 2200, text: '第一段\n换行', source: 'edited' },
  { id: 'empty', startMs: 0, endMs: 1000, text: ' ' },
  { id: 'bad', startMs: 5000, endMs: 4000, text: '错误' },
], 5000)
assert.deepEqual(cues.map((cue) => cue.id), ['same-2', 'same'])
assert.equal(cues[0].text, '第一段 换行')
assert.equal(cues[1].endMs, 4001)
assert.deepEqual({
  fontSize: DEFAULT_SUBTITLE_STYLE.fontSize,
  fontWeight: DEFAULT_SUBTITLE_STYLE.fontWeight,
  backgroundOpacity: DEFAULT_SUBTITLE_STYLE.backgroundOpacity,
  cornerRadius: DEFAULT_SUBTITLE_STYLE.cornerRadius,
  positionY: DEFAULT_SUBTITLE_STYLE.positionY,
}, {
  fontSize: 50,
  fontWeight: 400,
  backgroundOpacity: 60,
  cornerRadius: 60,
  positionY: 90,
})

const track = normalizeSubtitleTrack({
  schemaVersion: 1,
  enabled: true,
  language: 'zh',
  model: { id: 'model', version: '1', sha256: 'a' },
  sourceRange: { startMs: 1500, endMs: 3500 },
  sourceFingerprint: { size: 10, modifiedAtMs: 20 },
  cues,
  style: {
    fontSize: 60,
    fontWeight: 700,
    fontFamily: 'Source Han Sans SC',
    fontFile: 'fonts/SourceHanSansSC-Bold.otf',
    textColor: '#F0F0F0',
    backgroundColor: '#123456',
    backgroundOpacity: 40,
    borderColor: '#ABCDEF',
    borderWidth: 3,
    cornerRadius: 18,
    positionY: 80,
    fontAssets: [{ fileName: 'MyFont.ttf', filePath: '/tmp/MyFont.ttf', format: 'ttf' }],
  },
  generatedAt: '2026-07-30T00:00:00.000Z',
})
assert.ok(track)
assert.equal(track.style.fontWeight, 700)
assert.deepEqual(track.style.fontAssets?.map((font) => font.fileName), ['MyFont.ttf'])
assert.equal(subtitleTrackToSrt(track), '1\n00:00:00,000 --> 00:00:00,700\n第一段 换行\n\n2\n00:00:01,000 --> 00:00:02,000\n第二段\n')
assert.equal(wrapSubtitleText('一二三四五六七八九十', 4), '一二三四\n五六七八\n九十')

const layers = buildSubtitleLayers(track, { width: 1920, height: 1080 }, { startMs: 1500, endMs: 3500 })
assert.equal(layers.length, 4)
assert.deepEqual([layers[0].activeStart, layers[0].activeEnd], [0, 0.7])
assert.deepEqual([layers[2].activeStart, layers[2].activeEnd], [1, 2])
assert.equal(layers[0].fillColor, '#12345666')
assert.equal(layers[0].strokeWidth, 3)
assert.ok(layers[0].cornerRadius > 0 && layers[0].cornerRadius < 0.5)
assert.ok(layers[0].dstW < 0.86)
assert.equal(layers[0].dstX, layers[1].dstX)
assert.equal(layers[0].dstW, layers[1].dstW)
assert.equal(layers[1].fontFile, 'fonts/SourceHanSansSC-Regular.otf')
assert.equal(layers[1].fontSize, 60)
const composition = buildCompositionFromPreviewLayers(layers, 1920, 1080)
assert.deepEqual([composition.layers[2].activeStart, composition.layers[2].activeEnd], [1, 2])

console.log('subtitle track tests passed')
