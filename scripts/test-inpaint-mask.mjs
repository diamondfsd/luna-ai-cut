import assert from 'node:assert/strict'
import { dilateInpaintMask, featherInpaintMask, INPAINT_MODEL_SIZE, resampleInpaintMask } from '../electron/inpaintMask.ts'

const empty = new Uint8Array(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE)
assert.equal(dilateInpaintMask(empty, 12).some(Boolean), false, 'empty mask must stay empty')

const point = empty.slice()
point[256 * INPAINT_MODEL_SIZE + 256] = 255
const expanded = dilateInpaintMask(point, 2)
assert.equal(expanded.reduce((count, value) => count + Number(value > 0), 0), 25, 'radius 2 must create a 5x5 model mask')
assert.equal(expanded[253 * INPAINT_MODEL_SIZE + 256], 0, 'dilation must not exceed the requested radius')

const feathered = featherInpaintMask(expanded, 2)
assert.equal(feathered.every((value) => value >= 0 && value <= 255), true, 'alpha must stay bounded')
assert.equal(feathered[256 * INPAINT_MODEL_SIZE + 256], 255, 'mask center must stay opaque')
assert.ok(feathered[254 * INPAINT_MODEL_SIZE + 256] > 0, 'feather must create a soft edge')

const source = new Uint8Array([0, 255, 0, 255])
const sampled = resampleInpaintMask(source, 2, 2)
assert.equal(sampled[0], 0)
assert.equal(sampled[INPAINT_MODEL_SIZE - 1], 255)
assert.equal(sampled[(INPAINT_MODEL_SIZE - 1) * INPAINT_MODEL_SIZE], 0)
assert.equal(sampled[sampled.length - 1], 255)

console.log('inpaint mask tests passed')
