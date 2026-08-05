import assert from 'node:assert/strict'
import { segmentSubtitleUnits, subtitleUnitsFromCues } from '../src/shared/subtitleSegmentation.ts'

const raw = [
  { id: 'raw-1', startMs: 0, endMs: 1600, text: '大家好今天给大家介绍', source: 'generated' },
  { id: 'raw-2', startMs: 1600, endMs: 3200, text: '一下Luna的自动字幕功能', source: 'generated' },
  { id: 'raw-3', startMs: 3200, endMs: 4700, text: '识别完成以后我们还可以', source: 'generated' },
  { id: 'raw-4', startMs: 4700, endMs: 5700, text: '继续编辑字幕内容', source: 'generated' },
]
const units = subtitleUnitsFromCues(raw)
const punctuation = units.map(() => '_')
for (const [token, mark] of [['好', '，'], ['能', '。'], ['后', '，'], ['容', '。']]) {
  const index = units.findIndex((unit) => unit.text === token && punctuation[units.indexOf(unit)] === '_')
  punctuation[index] = mark
}
const cues = segmentSubtitleUnits(units, punctuation)
assert.equal(cues.map((cue) => cue.text).join(''), '大家好，今天给大家介绍一下Luna的自动字幕功能。识别完成以后，我们还可以继续编辑字幕内容。')
assert.ok(cues.some((cue) => cue.text.endsWith('。')))
assert.ok(cues.every((cue) => !/^[的了着和]/u.test(cue.text)))
assert.ok(cues.every((cue) => !/[的了着和]$/u.test(cue.text.replace(/[，。！？,!?]$/u, ''))))
assert.ok(cues.every((cue) => !cue.text.endsWith('自')))
assert.equal(cues[0].startMs, 0)
assert.equal(cues.at(-1).endMs, 5700)
assert.ok(cues.every((cue) => cue.endMs > cue.startMs))

const longUnits = subtitleUnitsFromCues([{ id: 'long', startMs: 0, endMs: 8_000, text: '这是一个没有任何标点但是长度很长需要自动平衡处理的字幕分段测试内容', source: 'generated' }])
const balanced = segmentSubtitleUnits(longUnits, longUnits.map(() => '_'))
assert.ok(balanced.length >= 2)
assert.ok(balanced.every((cue) => [...cue.text].length <= 20))
assert.ok([...balanced.at(-1).text].length >= 6)
assert.ok(balanced.every((cue) => !/^[的了着和]/u.test(cue.text)))

const pausedUnits = subtitleUnitsFromCues([
  { id: 'pause-1', startMs: 100, endMs: 900, text: '前半句话', source: 'generated' },
  { id: 'pause-2', startMs: 1800, endMs: 2600, text: '停顿后继续', source: 'generated' },
])
assert.deepEqual(segmentSubtitleUnits(pausedUnits, pausedUnits.map(() => '_')).map((cue) => cue.text), ['前半句话', '停顿后继续'])

const crossCueWord = subtitleUnitsFromCues([
  { id: 'word-1', startMs: 0, endMs: 500, text: '自', source: 'generated' },
  { id: 'word-2', startMs: 500, endMs: 1_000, text: '动字幕', source: 'generated' },
])
assert.equal(crossCueWord[0].wordBoundaryAfter, false)
assert.equal(crossCueWord[1].wordBoundaryAfter, true)

console.log('subtitle segmentation tests passed')
