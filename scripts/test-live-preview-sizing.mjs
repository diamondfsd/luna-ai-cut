import assert from 'node:assert/strict'

import { livePreviewOutputSize } from '../src/components/livePreviewSizing.ts'

assert.deepEqual(livePreviewOutputSize(720, 1280), { width: 720, height: 1280 })
assert.deepEqual(livePreviewOutputSize(1280, 720), { width: 1280, height: 720 })
assert.deepEqual(livePreviewOutputSize(0, 0), { width: 1280, height: 1280 })

console.info('Live preview output sizing checks passed')
