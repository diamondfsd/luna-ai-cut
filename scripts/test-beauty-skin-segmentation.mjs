import assert from 'node:assert/strict'

import { bodySkinMaskFromHumanLabels, softenBeautyMask } from '../electron/beautySkinSegmentation.ts'

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

console.log('Beauty skin segmentation tests passed')
