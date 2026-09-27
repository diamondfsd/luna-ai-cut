import assert from 'node:assert/strict'

import { livePreviewOutputSize } from '../src/components/livePreviewSizing.ts'

assert.deepEqual(livePreviewOutputSize(720, 1280, '1080p'), { width: 1080, height: 1920 })
assert.deepEqual(livePreviewOutputSize(720, 1280, '720p'), { width: 720, height: 1280 })
assert.deepEqual(livePreviewOutputSize(1920, 1080, '1080p'), { width: 1920, height: 1080 })
assert.deepEqual(livePreviewOutputSize(1280, 720, '720p'), { width: 1280, height: 720 })
assert.deepEqual(livePreviewOutputSize(0, 0, '720p'), { width: 1280, height: 1280 })

console.info('Live preview output sizing checks passed')
