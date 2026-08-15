import assert from 'node:assert/strict'
import { renderToolResult } from './deepseek-harness-freecut-plugin.mjs'

const result = {
  ok: true,
  message: '已读取当前剪辑项目。',
  data: {
    tracks: [{ id: 'track-1', name: 'V1', itemCount: 1 }],
    items: [{ id: 'clip-1', mediaId: 'media-1', fromSeconds: 0, toSeconds: 8 }],
  },
}

const rendered = renderToolResult({}, result)
assert.equal(rendered.length, 1)
assert.equal(rendered[0].type, 'text')
assert.deepEqual(JSON.parse(rendered[0].text), result)
assert.match(rendered[0].text, /clip-1/)
assert.match(rendered[0].text, /media-1/)

console.log('DeepSeek Harness FreeCut tool result rendering passed.')
