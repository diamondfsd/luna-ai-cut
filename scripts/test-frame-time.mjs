import assert from 'node:assert/strict'

import {
  constrainTrimEnd,
  constrainTrimStart,
  frameCountForDuration,
  frameIndexAtTime,
  snapTimeToFrame,
  timeAtFrame,
} from '../src/workspace/trim/frameTime.ts'
import { livePhotoRangeAround, resizeLivePhotoRange } from '../src/workspace/trim/videoOutputMarkers.ts'

const fps = 29.97
const frameTime = timeAtFrame(30, fps)

assert.equal(frameIndexAtTime(frameTime, fps), 30)
assert.equal(snapTimeToFrame(1.004, fps), frameTime)
assert.equal(frameCountForDuration(3, fps, 0.1, 5), 90)
assert.equal(constrainTrimStart(0.2, 1, 10, fps), timeAtFrame(6, fps))
assert.equal(constrainTrimEnd(0.4, 0.2, 10, fps), timeAtFrame(12, fps))
assert.equal(constrainTrimEnd(0.4, 0, 0, fps), 0)

const liveRange = livePhotoRangeAround(1.25, 10, 3, fps)
assert.ok(liveRange)
assert.equal(frameIndexAtTime(liveRange.startTime, fps), 0)
assert.equal(frameIndexAtTime(liveRange.endTime, fps), 90)
assert.ok(liveRange.coverTime < liveRange.endTime)

const resized = resizeLivePhotoRange(4, 7, 5.5, 1.5, 20, fps)
assert.ok(resized)
assert.equal(frameIndexAtTime(resized.endTime - resized.startTime, fps), 45)
assert.ok(resized.coverTime >= resized.startTime && resized.coverTime < resized.endTime)

console.log('frame time tests passed')
