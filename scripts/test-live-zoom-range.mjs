import assert from 'node:assert/strict'
import { liveZoomMaximum } from '../src/lib/liveZoomRange.ts'

assert.equal(liveZoomMaximum(15, 16 / 9), 15)
assert.equal(liveZoomMaximum(15, 9 / 16), 6)
assert.equal(liveZoomMaximum(20, 16 / 9), 15)
assert.equal(liveZoomMaximum(20, 9 / 16), 6)
assert.equal(liveZoomMaximum(4, 16 / 9), 4)
assert.equal(liveZoomMaximum(4, 9 / 16), 4)
console.log('Live zoom orientation and device limit checks passed')
