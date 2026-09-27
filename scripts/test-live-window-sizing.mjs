import assert from 'node:assert/strict'

import { liveWindowContentSize } from '../electron/application/liveWindowSizing.ts'

assert.deepEqual(
  liveWindowContentSize('720p', 2, { width: 1728, height: 1117 }),
  { width: 640, height: 360 },
)
const scaled720p = liveWindowContentSize('720p', 1.5, { width: 2560, height: 1440 })
assert.deepEqual(scaled720p, { width: 853, height: 480 })
assert.ok(Math.abs(scaled720p.width * 1.5 - 1280) <= 1)
assert.equal(scaled720p.height * 1.5, 720)
assert.deepEqual(
  liveWindowContentSize('720p', 2, { width: 1728, height: 1117 }),
  { width: 640, height: 360 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 1, { width: 1440, height: 900 }),
  { width: 1280, height: 720 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 0, { width: 800, height: 600 }),
  { width: 768, height: 432 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 2, { width: 1728, height: 1117 }, 9 / 16),
  { width: 360, height: 640 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 2, { width: 1728, height: 1117 }, 16 / 9),
  { width: 640, height: 360 },
)

console.info('Live window sizing checks passed')
