import assert from 'node:assert/strict'

import {
  bodySkinMaskFromHumanLabels,
  faceSkinMaskFromSamples,
  personMaskFromHumanLabels,
  softenBeautyMask,
} from '../electron/beautySkinSegmentation.ts'

const labels = new Uint8Array([
  14, 6,
  0, 12,
])
const mask = bodySkinMaskFromHumanLabels(labels, 2, 4)
assert.deepEqual([...mask], [
  255, 255, 0, 0,
  255, 255, 0, 0,
  0, 0, 255, 255,
  0, 0, 255, 255,
])
assert.deepEqual([...personMaskFromHumanLabels(labels, 2, 4)], [
  255, 255, 255, 255,
  255, 255, 255, 255,
  0, 0, 255, 255,
  0, 0, 255, 255,
])
assert.throws(
  () => bodySkinMaskFromHumanLabels(new Uint8Array(3), 2, 4),
  /尺寸不一致/,
)
assert.throws(
  () => personMaskFromHumanLabels(new Uint8Array(3), 2, 4),
  /尺寸不一致/,
)

const hardEdge = new Uint8Array(9 * 9)
for (let y = 2; y <= 6; y += 1) {
  for (let x = 2; x <= 6; x += 1) hardEdge[y * 9 + x] = 255
}
const softEdge = softenBeautyMask(hardEdge, 9, 2)
assert.ok(softEdge[4 * 9 + 4] > softEdge[4 * 9 + 1], '皮肤中心必须比边缘保持更高强度')
assert.ok(softEdge[4 * 9 + 1] > 0 && softEdge[4 * 9 + 1] < 255, '皮肤边缘必须形成渐进过渡')

const videoMaskSize = 512
const videoMaskLength = videoMaskSize * videoMaskSize
const videoSkinSamples = new Uint32Array(videoMaskLength)
const videoProtectedSamples = new Uint32Array(videoMaskLength)
const videoTotalSamples = new Uint32Array(videoMaskLength)
const videoCenter = Math.floor(videoMaskSize / 2) * videoMaskSize + Math.floor(videoMaskSize / 2)
videoSkinSamples[videoCenter] = 1
videoTotalSamples[videoCenter] = 1
const videoFaceMask = faceSkinMaskFromSamples(
  videoSkinSamples,
  videoProtectedSamples,
  videoTotalSamples,
  videoMaskSize,
  10,
)
assert.equal(videoFaceMask.length, videoMaskLength, '视频面部蒙版必须使用视频输出尺寸')
assert.ok(videoFaceMask[videoCenter] > 0, '视频面部蒙版必须完成柔化')
assert.throws(
  () => faceSkinMaskFromSamples(
    new Uint32Array(1024 * 1024),
    new Uint32Array(1024 * 1024),
    new Uint32Array(1024 * 1024),
    videoMaskSize,
    10,
  ),
  /尺寸不一致/,
)

console.log('Beauty skin segmentation tests passed')
