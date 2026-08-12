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

const jsonReplyChunks = [
  '```json\n{\n  "re',
  'ply": "# 剪辑方案\\n\\n- 第一段\\n- 引用：\\"画面\\"\\n- 图标：\\u',
  '4F60\\u597D",\n  "toolCalls": [{"id":"source.create","args":{"content":"',
  '# 不应显示\\n非常大的源码参数',
  '"}}]}\n```',
]

async function* chunkedJsonReply() {
  for (const content of jsonReplyChunks) yield { choices: [{ delta: { content } }] }
}

const jsonReplyPreviews = []
const jsonReplyResult = await consumeAiEditingAssistantStream(chunkedJsonReply(), {
  contentPreviewMode: 'json-reply',
  onPreview: (preview) => jsonReplyPreviews.push(preview),
})

assert.deepEqual(jsonReplyPreviews, [
  { text: '# 剪辑方案\n\n- 第一段\n- 引用："画面"\n- 图标：', kind: 'content' },
  { text: '# 剪辑方案\n\n- 第一段\n- 引用："画面"\n- 图标：你好', kind: 'content' },
  { text: '# 剪辑方案\n\n- 第一段\n- 引用："画面"\n- 图标：你好', kind: 'content' },
  { text: '# 剪辑方案\n\n- 第一段\n- 引用："画面"\n- 图标：你好', kind: 'content' },
])
assert.equal(jsonReplyResult.content, jsonReplyChunks.join('').trim())
assert.ok(jsonReplyPreviews.every(({ text }) => !text.includes('source.create')))
assert.ok(jsonReplyPreviews.every(({ text }) => !text.includes('不应显示')))

async function* incompleteJsonReply() {
  yield { choices: [{ delta: { content: '{"toolCalls":[],' } }] }
  yield { choices: [{ delta: { content: '"reply":"正文末尾\\' } }] }
}

const incompletePreviews = []
const incompleteResult = await consumeAiEditingAssistantStream(incompleteJsonReply(), {
  contentPreviewMode: 'json-reply',
  onPreview: (preview) => incompletePreviews.push(preview),
})
assert.deepEqual(incompletePreviews, [{ text: '正文末尾', kind: 'content' }])
assert.equal(incompleteResult.content, '{"toolCalls":[],"reply":"正文末尾\\')

async function* jsonWithoutReply() {
  yield { choices: [{ delta: { content: '{"toolCalls":[{"args":{"content":"源码"}}]}' } }] }
}

let leakedPreview = false
await consumeAiEditingAssistantStream(jsonWithoutReply(), {
  contentPreviewMode: 'json-reply',
  onPreview: () => { leakedPreview = true },
})
assert.equal(leakedPreview, false)

console.log('AI editing assistant stream tests passed')
