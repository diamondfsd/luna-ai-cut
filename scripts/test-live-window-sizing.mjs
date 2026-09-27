import assert from 'node:assert/strict'

import { liveWindowContentSize } from '../electron/application/liveWindowSizing.ts'

assert.deepEqual(
  liveWindowContentSize('1080p', 2, { width: 1728, height: 1117 }),
  { width: 960, height: 540 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 2, { width: 1728, height: 1117 }),
  { width: 640, height: 360 },
)
assert.deepEqual(
  liveWindowContentSize('1080p', 1, { width: 1440, height: 900 }),
  { width: 1408, height: 792 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 0, { width: 800, height: 600 }),
  { width: 768, height: 432 },
)
assert.deepEqual(
  liveWindowContentSize('1080p', 2, { width: 1728, height: 1117 }, 9 / 16),
  { width: 540, height: 960 },
)
assert.deepEqual(
  liveWindowContentSize('720p', 2, { width: 1728, height: 1117 }, 16 / 9),
  { width: 640, height: 360 },
)

console.info('Live window sizing checks passed')
