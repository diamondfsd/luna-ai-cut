/* global Buffer */

import assert from 'node:assert/strict'

import { buildDjiDeletePayload } from '../electron/devices/dji/djiDeleteCodec.ts'
import { markSharedManifestHandles } from '../electron/devices/dji/djiManifest.ts'

assert.equal(
  buildDjiDeletePayload([0x00040000, 0x40100040], 0x11223344).toString('hex'),
  '02000004004000104044332211000200000001010000',
)
assert.throws(() => buildDjiDeletePayload([], 1), /不能没有素材句柄/)
assert.throws(() => buildDjiDeletePayload([1, 1], 1), /重复素材句柄/)
assert.throws(() => buildDjiDeletePayload([0x100000000], 1), /素材句柄无效/)
assert.throws(() => buildDjiDeletePayload([1], 0x100000000), /序号无效/)

const manifest = markSharedManifestHandles([
  { path: 'a', name: 'a.JPG', thumbPath: null, handle: 7, bytes: null, extension: 'JPG', storageId: 'sdcard' },
  { path: 'b', name: 'b.JPG', thumbPath: null, handle: 7, bytes: null, extension: 'JPG', storageId: 'storage_internal' },
  { path: 'c', name: 'c.JPG', thumbPath: null, handle: 0, bytes: null, extension: 'JPG', storageId: 'sdcard' },
])
assert.equal(manifest[0].handleShared, true)
assert.equal(manifest[1].handleShared, true)
assert.equal(manifest[2].handleShared, undefined)

console.log('DJI delete tests passed')
