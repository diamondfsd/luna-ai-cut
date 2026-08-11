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
  yield {
    choices: [],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 80 },
    },
  }
}

const previews = []
let activities = 0
const result = await consumeAiEditingAssistantStream(chunks(), {
  onActivity: () => { activities += 1 },
  onPreview: (preview) => previews.push(preview),
})

assert.equal(activities, 6)
assert.deepEqual(previews.slice(0, 2), [
  { text: '先检查素材\n', kind: 'reasoning' },
  { text: '先检查素材\n再整理节奏', kind: 'reasoning' },
])
assert.deepEqual(previews.at(-1), { text: '方案', kind: 'content' })
assert.deepEqual(result, {
  content: '方案',
  toolCalls: [{ id: 'call-1', name: 'apply_edit', arguments: '{"value":1}' }],
  usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150, cachedTokens: 80 },
})

async function* invalidUsageChunks() {
  yield { choices: [{ delta: { content: '仍然可用' } }] }
  yield {
    choices: [],
    usage: { prompt_tokens: null, completion_tokens: 2, total_tokens: 2 },
  }
}

assert.deepEqual(await consumeAiEditingAssistantStream(invalidUsageChunks()), {
  content: '仍然可用',
  toolCalls: [],
})

async function* missingCacheUsageChunks() {
  yield { choices: [{ delta: { content: '没有缓存明细' } }] }
  yield {
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  }
}

assert.deepEqual((await consumeAiEditingAssistantStream(missingCacheUsageChunks())).usage, {
  promptTokens: 10,
  completionTokens: 2,
  totalTokens: 12,
  cachedTokens: 0,
})

console.log('AI editing assistant stream tests passed')
