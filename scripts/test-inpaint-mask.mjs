import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import {
  compositeInpaintRegion,
  createInpaintMaskJobs,
  createInpaintRefinementJobs,
  createInpaintRegion,
  dilateInpaintMask,
  featherInpaintMask,
  INPAINT_MODEL_SIZE,
  modelRadiusForSourcePixels,
  prepareInpaintInputs,
  resampleInpaintMask,
} from '../electron/features/segmentation/inpaintMask.ts'

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

const wideMask = new Uint8Array(400 * 200)
for (let y = 90; y < 110; y++) for (let x = 180; x < 220; x++) wideMask[y * 400 + x] = 255
const localRegion = createInpaintRegion(wideMask, 400, 200, 4000, 2000)
assert.deepEqual(localRegion, { x: 1550, y: 550, size: 900 }, 'moderately wide selections must keep more target detail while retaining local context')
assert.equal(modelRadiusForSourcePixels(12, localRegion), 7, 'edge controls must be converted from source pixels to model pixels')
const refinementJobs = createInpaintRefinementJobs(createInpaintMaskJobs(wideMask, 400, 200, 4000, 2000), 400, 200, 4000, 2000)
assert.equal(refinementJobs.length, 4, 'large selections must be split into bounded detail refinement jobs')
assert.ok(refinementJobs.every((job) => job.region.size === INPAINT_MODEL_SIZE), 'detail jobs should avoid enlarging generated pixels when the selection allows it')
assert.equal(
  refinementJobs.reduce((pixels, job) => pixels + job.mask.reduce((count, value) => count + Number(value > 0), 0), 0),
  wideMask.reduce((count, value) => count + Number(value > 0), 0),
  'detail jobs must cover every selected pixel exactly once',
)

const separatedMask = new Uint8Array(400 * 200)
for (let y = 90; y < 110; y++) for (let x = 30; x < 50; x++) separatedMask[y * 400 + x] = 255
for (let y = 90; y < 110; y++) for (let x = 350; x < 370; x++) separatedMask[y * 400 + x] = 255
const separatedJobs = createInpaintMaskJobs(separatedMask, 400, 200, 4000, 2000)
assert.equal(separatedJobs.length, 2, 'distant selections must use separate high-detail inpaint jobs')
assert.ok(separatedJobs.every((job) => job.region.size === 600), 'each distant selection must retain its own local context')
assert.equal(separatedJobs.reduce((count, job) => count + Number(job.mask.some(Boolean)), 0), 2, 'each split job must retain selected pixels')

const nearbyMask = new Uint8Array(40 * 20)
for (let y = 8; y < 11; y++) for (let x = 10; x < 13; x++) nearbyMask[y * 40 + x] = 255
for (let y = 8; y < 11; y++) for (let x = 16; x < 19; x++) nearbyMask[y * 40 + x] = 255
assert.equal(createInpaintMaskJobs(nearbyMask, 40, 20, 4000, 2000).length, 1, 'nearby mask fragments must stay in one coherent inpaint job')

const panoramicMask = new Uint8Array(400 * 100).fill(255)
const panoramicRegion = createInpaintRegion(panoramicMask, 400, 100, 4000, 1000)
assert.deepEqual(panoramicRegion, { x: 0, y: -1500, size: 4000 }, 'wide selections must preserve aspect ratio with virtual edge padding')

const tinySource = Buffer.alloc(4 * 2 * 3)
for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
  const pixel = (y * 4 + x) * 3
  tinySource[pixel] = x * 60
  tinySource[pixel + 1] = y * 120
}
const tinyMask = new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255])
const prepared = prepareInpaintInputs(tinySource, 4, 2, tinyMask, 4, 2, { x: 0, y: -1, size: 4 })
assert.equal(prepared.rgb.length, INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE * 3)
assert.equal(prepared.mask.slice(0, INPAINT_MODEL_SIZE).some(Boolean), false, 'virtual context outside the image must never be selected')
assert.equal(prepared.mask.some(Boolean), true, 'the selected source area must map into the model mask')

const untouched = Buffer.from([10, 20, 30, 40, 50, 60])
const generated = new Uint8Array(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE * 3).fill(200)
const transparent = new Uint8Array(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE)
assert.deepEqual(
  compositeInpaintRegion(untouched, 2, 1, generated, transparent, { x: 0, y: 0, size: 2 }),
  untouched,
  'transparent generated pixels must not alter the original image',
)

console.log('inpaint mask tests passed')
