import assert from 'node:assert/strict'

import { resolveLivePhotoCoverTime } from '../src/workspace/shared/livePhotoFrameTime.ts'

assert.equal(
  resolveLivePhotoCoverTime(0, 3, 2.99, 30),
  2.9,
  'cover frames near the end must keep enough distance from EOF',
)

assert.equal(
  resolveLivePhotoCoverTime(0, 3, 1.5, 30),
  1.5,
  'cover frames away from the boundary must remain unchanged',
)

assert.equal(
  resolveLivePhotoCoverTime(5, 3, 7.99, null),
  7.9,
  'segments with a non-zero start must apply the boundary in source time',
)

assert.equal(
  resolveLivePhotoCoverTime(5, 3, 4, 60),
  5,
  'cover frames must not move before the segment start',
)

console.log('live photo frame time tests passed')
