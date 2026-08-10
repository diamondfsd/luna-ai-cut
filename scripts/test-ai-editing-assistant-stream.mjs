import assert from 'node:assert/strict'

import { consumeAiEditingAssistantStream } from '../electron/aiEditingAssistantStream.ts'

async function* chunks() {
  yield { choices: [{ delta: { reasoning_content: '先检查素材\n' } }] }
  yield { choices: [{ delta: { reasoning_content: '再整理节奏' } }] }
  yield { choices: [{ delta: { content: '方案' } }] }
  yield {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call-1',
          function: { name: 'apply_', arguments: '{"value":' },
        }],
      },
    }],
  }
  yield {
    choices: [{
      delta: { tool_calls: [{ index: 0, function: { name: 'edit', arguments: '1}' } }] },
    }],
  }
}

const previews = []
let activities = 0
const result = await consumeAiEditingAssistantStream(chunks(), {
  onActivity: () => { activities += 1 },
  onPreview: (preview) => previews.push(preview),
})

assert.equal(activities, 5)
assert.deepEqual(previews.slice(0, 2), [
  { text: '先检查素材\n', kind: 'reasoning' },
  { text: '先检查素材\n再整理节奏', kind: 'reasoning' },
])
assert.deepEqual(previews.at(-1), { text: '方案', kind: 'content' })
assert.deepEqual(result, {
  content: '方案',
  toolCalls: [{ id: 'call-1', name: 'apply_edit', arguments: '{"value":1}' }],
})

console.log('AI editing assistant stream tests passed')
