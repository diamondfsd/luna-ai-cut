import assert from 'node:assert/strict'

import { createUsbAccessoryShutdown } from '../electron/media/live-stream/usbAccessoryLifecycle.ts'

const events = []
let finishPolling
let finishWrites
let finishRelease
const shutdown = createUsbAccessoryShutdown({
  stopPolling: () => new Promise((resolve) => {
    events.push('stop-poll')
    finishPolling = resolve
  }),
  waitForControlWrites: () => new Promise((resolve) => {
    events.push('wait-writes')
    finishWrites = resolve
  }),
  releaseInterface: () => new Promise((resolve) => {
    events.push('release')
    finishRelease = resolve
  }),
  closeDevice: () => events.push('close'),
})

const first = shutdown()
const second = shutdown()
assert.equal(first, second)
assert.deepEqual(events, ['stop-poll'])
finishPolling()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(events, ['stop-poll', 'wait-writes'])
finishWrites()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(events, ['stop-poll', 'wait-writes', 'release'])
finishRelease()
await first
assert.deepEqual(events, ['stop-poll', 'wait-writes', 'release', 'close'])

console.info('USB accessory shutdown ordering checks passed')
