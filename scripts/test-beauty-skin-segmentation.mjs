import assert from 'node:assert/strict'

import { bodySkinMaskFromHumanLabels } from '../electron/beautySkinSegmentation.ts'

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

console.log('Beauty skin segmentation tests passed')
