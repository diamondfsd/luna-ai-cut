import assert from 'node:assert/strict'

import {
  AiEditingAssistantAttemptTimeoutError,
  runAiEditingAssistantRequestWithRetry,
} from '../electron/aiEditingAssistantRetry.ts'

let attempts = 0
const retries = []
const recovered = await runAiEditingAssistantRequestWithRetry({
  signal: new AbortController().signal,
  attemptTimeoutMs: 100,
  retryDelayMs: 1,
  shouldRetry: () => true,
  onRetry: (_error, attempt, nextAttempt) => retries.push([attempt, nextAttempt]),
  execute: async () => {
    attempts += 1
    if (attempts < 3) throw new Error('temporary')
    return 'ok'
  },
})
assert.equal(recovered, 'ok')
assert.equal(attempts, 3)
assert.deepEqual(retries, [[1, 2], [2, 3]])

attempts = 0
await assert.rejects(
  runAiEditingAssistantRequestWithRetry({
    signal: new AbortController().signal,
    attemptTimeoutMs: 100,
    retryDelayMs: 1,
    shouldRetry: () => false,
    execute: async () => {
      attempts += 1
      throw new Error('permanent')
    },
  }),
  /permanent/,
)
assert.equal(attempts, 1)

attempts = 0
await assert.rejects(
  runAiEditingAssistantRequestWithRetry({
    signal: new AbortController().signal,
    maxAttempts: 2,
    attemptTimeoutMs: 5,
    retryDelayMs: 1,
    shouldRetry: (error) => error instanceof AiEditingAssistantAttemptTimeoutError,
    execute: async (signal) => {
      attempts += 1
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      return 'unreachable'
    },
  }),
  (error) => error instanceof AiEditingAssistantAttemptTimeoutError,
)
assert.equal(attempts, 2)

attempts = 0
const cancellation = new AbortController()
const cancelledRequest = runAiEditingAssistantRequestWithRetry({
  signal: cancellation.signal,
  attemptTimeoutMs: 100,
  retryDelayMs: 1,
  shouldRetry: () => true,
  execute: async (signal) => {
    attempts += 1
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    return 'unreachable'
  },
})
cancellation.abort()
await assert.rejects(cancelledRequest, (error) => error?.name === 'AbortError')
assert.equal(attempts, 1)

console.log('AI editing assistant retry tests passed')
