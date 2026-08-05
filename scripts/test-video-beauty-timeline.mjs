import assert from 'node:assert/strict'

import { maskTimelineSampleAt, maskTimelineSampleTimes, normalizeMaskTimeline } from '../src/workspace/mask/maskTimeline.ts'

const timeline = {
  version: 1,
  startTime: 0,
  endTime: 2,
  sampleInterval: 0.5,
  frames: [
    { time: 0, path: 'face-0.pgm' },
    { time: 1 },
    { time: 2, path: 'face-2.pgm' },
  ],
}

assert.equal(maskTimelineSampleAt(timeline, -0.01), undefined)
assert.equal(maskTimelineSampleAt(timeline, 0.2)?.path, 'face-0.pgm')
assert.equal(maskTimelineSampleAt(timeline, 1)?.path, undefined)
assert.equal(maskTimelineSampleAt(timeline, 1.8)?.path, 'face-2.pgm')
assert.equal(maskTimelineSampleAt(timeline, 2.01), undefined)
assert.deepEqual(normalizeMaskTimeline({ ...timeline, sampleInterval: 0, frames: [...timeline.frames].reverse() }), timeline)
assert.deepEqual(maskTimelineSampleTimes(0, 0.5), [0])
const sampleTimes = maskTimelineSampleTimes(2, 0.5)
assert.equal(sampleTimes[0], 0)
assert.equal(sampleTimes.at(-1), 1.95)
assert.equal(sampleTimes.includes(2), false)

console.log('video beauty timeline tests passed')
