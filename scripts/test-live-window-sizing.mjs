import assert from 'node:assert/strict'

import { liveWindowContentSize } from '../electron/application/liveWindowSizing.ts'

assert.deepEqual(
  liveWindowContentSize('720p', { width: 1728, height: 1117 }),
  { width: 1280, height: 720 },
)
assert.deepEqual(
  liveWindowContentSize('720p', { width: 2560, height: 1440 }),
  { width: 1280, height: 720 },
)
assert.deepEqual(
  liveWindowContentSize('720p', { width: 1440, height: 900 }),
  { width: 1280, height: 720 },
)
assert.deepEqual(
  liveWindowContentSize('720p', { width: 800, height: 600 }),
  { width: 768, height: 432 },
)
assert.deepEqual(
  liveWindowContentSize('720p', { width: 1728, height: 1117 }, 9 / 16),
  { width: 610, height: 1085 },
)
assert.deepEqual(
  liveWindowContentSize('720p', { width: 1728, height: 1117 }, 16 / 9),
  { width: 1280, height: 720 },
)

console.info('Live window sizing checks passed')
