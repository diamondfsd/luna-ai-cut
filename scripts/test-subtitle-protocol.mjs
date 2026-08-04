import assert from 'node:assert/strict'
import { normalizeGeneratedSubtitleText, normalizeSubtitleCuesLanguage, parseSubtitleWorkerEvent, subtitleCueFromWorker } from '../electron/subtitleWorkerProtocol.ts'

const ready = parseSubtitleWorkerEvent('{"version":1,"type":"ready","modelLoadMs":120,"gpu":true}')
assert.equal(ready.type, 'ready')

const segment = parseSubtitleWorkerEvent('{"version":1,"type":"segment","startMs":1000.4,"endMs":2200.6,"text":"  测试字幕  "}')
assert.equal(segment.type, 'segment')
if (segment.type !== 'segment') throw new Error('segment parse failed')
const cue = subtitleCueFromWorker(segment)
assert.equal(cue?.startMs, 1000)
assert.equal(cue?.endMs, 2201)
assert.equal(cue?.text, '测试字幕')
assert.equal(cue?.source, 'generated')
assert.equal(
  normalizeSubtitleCuesLanguage([{ ...cue, text: '視頻字幕識別，時間軸與預覽 English 123' }], 'zh')[0].text,
  '视频字幕识别，时间轴与预览 English 123',
)
assert.equal(normalizeSubtitleCuesLanguage([{ ...cue, text: '影片預覽' }], 'en')[0].text, '影片預覽')

const complete = parseSubtitleWorkerEvent('{"type":"complete","version":1,"language":"zh","audioMs":76330,"inferenceMs":1321,"segmentCount":18}')
assert.equal(complete.type, 'complete')
if (complete.type !== 'complete') throw new Error('complete parse failed')
assert.equal(complete.language, 'zh')
assert.equal(complete.segmentCount, 18)

assert.throws(() => parseSubtitleWorkerEvent('{"version":2,"type":"complete"}'), /不兼容/)
assert.throws(() => parseSubtitleWorkerEvent('{"version":1,"type":"segment","text":"missing time"}'), /无效/)
assert.equal(subtitleCueFromWorker({ version: 1, type: 'segment', startMs: 1, endMs: 2, text: '  ' }), null)
assert.equal(normalizeGeneratedSubtitleText('大家好，今天测试一下！  Paraformer-zh。'), '大家好 今天测试一下 Paraformer zh')
assert.equal(subtitleCueFromWorker({ version: 1, type: 'segment', startMs: 10, endMs: 20, text: '你好，世界！' }).text, '你好 世界')

console.log('subtitle worker protocol tests passed')
