import assert from 'node:assert/strict'
import {
  decodeInstanceIds,
  hardExpandMask,
  selectInstancesFromStroke,
} from '../src/workspace/removal/instanceStrokeSelection.ts'

const instanceWidth = 8
const instanceHeight = 4
const instances = new Uint16Array(instanceWidth * instanceHeight)
for (let y = 0; y < instanceHeight; y += 1) {
  for (let x = 0; x < instanceWidth; x += 1) {
    instances[y * instanceWidth + x] = x < 4 ? 1 : 2
  }
}

const firstOnly = selectInstancesFromStroke({
  instanceIds: instances,
  instanceWidth,
  instanceHeight,
  targetWidth: instanceWidth,
  targetHeight: instanceHeight,
  points: [{ x: 0.1, y: 0.2 }, { x: 0.35, y: 0.8 }],
  strokeRadius: 0.75,
  minimumHits: 2,
  expansion: 0,
})
assert.ok(firstOnly)
assert.equal(firstOnly[1], 255)
assert.equal(firstOnly[6], 0)

const both = selectInstancesFromStroke({
  instanceIds: instances,
  instanceWidth,
  instanceHeight,
  targetWidth: instanceWidth,
  targetHeight: instanceHeight,
  points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
  strokeRadius: 0.75,
  minimumHits: 2,
  expansion: 0,
})
assert.ok(both?.every((value) => value === 255))

const isolatedNoise = new Uint16Array(16)
isolatedNoise[5] = 3
assert.equal(selectInstancesFromStroke({
  instanceIds: isolatedNoise,
  instanceWidth: 4,
  instanceHeight: 4,
  targetWidth: 4,
  targetHeight: 4,
  points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }],
  strokeRadius: 0.1,
  minimumHits: 2,
}), null)

const singlePixel = new Uint8Array(25)
singlePixel[12] = 255
const expanded = hardExpandMask(singlePixel, 5, 5, 1)
assert.equal(expanded.reduce((count, value) => count + Number(value === 255), 0), 9)

const encoded = new Uint8Array([1, 0, 2, 1]).buffer
assert.deepEqual([...decodeInstanceIds(encoded)], [1, 258])

console.log('instance stroke selection tests passed')
