import assert from 'node:assert/strict'

import {
  bodySkinMaskFromHumanLabels,
  faceSkinMaskFromSamples,
  softenBeautyMask,
} from '../electron/features/beauty/beautySkinSegmentation.ts'

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
assert.throws(
  () => bodySkinMaskFromHumanLabels(new Uint8Array(3), 2, 4),
  /尺寸不一致/,
)

const hardEdge = new Uint8Array(9 * 9)
for (let y = 2; y <= 6; y += 1) {
  for (let x = 2; x <= 6; x += 1) hardEdge[y * 9 + x] = 255
}
const softEdge = softenBeautyMask(hardEdge, 9, 2)
assert.ok(softEdge[4 * 9 + 4] > softEdge[4 * 9 + 1], '皮肤中心必须比边缘保持更高强度')
assert.ok(softEdge[4 * 9 + 1] > 0 && softEdge[4 * 9 + 1] < 255, '皮肤边缘必须形成渐进过渡')

const sampleMaskSize = 512
const sampleMaskLength = sampleMaskSize * sampleMaskSize
const sampleSkinSamples = new Uint32Array(sampleMaskLength)
const sampleProtectedSamples = new Uint32Array(sampleMaskLength)
const sampleTotalSamples = new Uint32Array(sampleMaskLength)
const sampleCenter = Math.floor(sampleMaskSize / 2) * sampleMaskSize + Math.floor(sampleMaskSize / 2)
sampleSkinSamples[sampleCenter] = 1
sampleTotalSamples[sampleCenter] = 1
const sampleFaceMask = faceSkinMaskFromSamples(
  sampleSkinSamples,
  sampleProtectedSamples,
  sampleTotalSamples,
  sampleMaskSize,
  10,
)
assert.equal(sampleFaceMask.length, sampleMaskLength, '面部蒙版必须保持输出尺寸')
assert.ok(sampleFaceMask[sampleCenter] > 0, '面部蒙版必须完成柔化')
assert.throws(
  () => faceSkinMaskFromSamples(
    new Uint32Array(1024 * 1024),
    new Uint32Array(1024 * 1024),
    new Uint32Array(1024 * 1024),
    sampleMaskSize,
    10,
  ),
  /尺寸不一致/,
)

console.log('Beauty skin segmentation tests passed')
