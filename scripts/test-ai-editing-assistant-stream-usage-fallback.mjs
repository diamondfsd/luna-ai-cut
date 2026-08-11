import assert from 'node:assert/strict'
import OpenAI from 'openai'

import { runStreamWithUsageFallback } from '../electron/aiEditingAssistantStreamUsage.ts'

function unsupported(message = "Unknown parameter: 'stream_options'") {
  return new OpenAI.APIError(400, { message }, message, new Headers())
}

const attempts = []
const recovered = await runStreamWithUsageFallback({
  createStream: async (includeUsage) => {
    attempts.push(includeUsage)
    if (includeUsage) throw unsupported()
    return ['ok']
  },
  consumeStream: async (stream, onChunk) => {
    onChunk()
    return stream.join('')
  },
})
assert.equal(recovered, 'ok')
assert.deepEqual(attempts, [true, false])

const knownUnsupportedAttempts = []
await runStreamWithUsageFallback({
  includeUsage: false,
  createStream: async (includeUsage) => {
    knownUnsupportedAttempts.push(includeUsage)
    return ['cached']
  },
  consumeStream: async (stream) => stream.join(''),
})
assert.deepEqual(knownUnsupportedAttempts, [false])

let partialAttempts = 0
await assert.rejects(
  runStreamWithUsageFallback({
    createStream: async () => {
      partialAttempts += 1
      return ['partial']
    },
    consumeStream: async (_stream, onChunk) => {
      onChunk()
      throw unsupported()
    },
  }),
  /stream_options/,
)
assert.equal(partialAttempts, 1)

let unrelatedAttempts = 0
await assert.rejects(
  runStreamWithUsageFallback({
    createStream: async () => {
      unrelatedAttempts += 1
      throw new OpenAI.APIError(
        400,
        { message: "Unknown parameter: 'response_format'" },
        "Unknown parameter: 'response_format'",
        new Headers(),
      )
    },
    consumeStream: async () => '',
  }),
  /response_format/,
)
assert.equal(unrelatedAttempts, 1)

console.log('AI editing assistant stream usage fallback tests passed')
