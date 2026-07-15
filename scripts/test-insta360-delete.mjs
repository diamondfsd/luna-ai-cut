#!/usr/bin/env node
import assert from 'node:assert/strict'

import { cameraPathsForFile, cameraPathsForFiles } from '../electron/cameraDeletePaths.ts'
import { buildDeleteFilesBody } from '../electron/insta360DeleteCodec.ts'

const firstPath = '/storage_internal/DCIM/Camera01/IMG_20260715_120000.jpg'
const secondPath = '/storage_internal/DCIM/Camera01/视频 01.mp4'
const body = buildDeleteFilesBody([firstPath, secondPath])
const firstBytes = Buffer.from(firstPath)
const secondBytes = Buffer.from(secondPath)
assert.deepEqual(body.subarray(0, 2), Buffer.from([0x0a, firstBytes.length]))
assert.equal(body.subarray(2, 2 + firstBytes.length).toString(), firstPath)
assert.deepEqual(body.subarray(2 + firstBytes.length, 4 + firstBytes.length), Buffer.from([0x0a, secondBytes.length]))
assert.equal(body.subarray(4 + firstBytes.length).toString(), secondPath)
assert.throws(() => buildDeleteFilesBody([]), /没有可删除/)

const longPath = `/storage_internal/DCIM/Camera01/${'a'.repeat(130)}.jpg`
const longBody = buildDeleteFilesBody([longPath])
assert.deepEqual(longBody.subarray(0, 3), Buffer.from([0x0a, 0xa6, 0x01]))
assert.equal(longBody.subarray(3).toString(), longPath)

const file = {
  sourceUrl: `http://192.168.42.1${firstPath}`,
  previewUrl: 'http://192.168.42.1/storage_internal/DCIM/Camera01/LRV_20260715_120000.lrv',
  livePhotoVideoUrl: null,
}
assert.deepEqual(cameraPathsForFile(file, '192.168.42.1'), [
  firstPath,
  '/storage_internal/DCIM/Camera01/LRV_20260715_120000.lrv',
])
assert.equal(cameraPathsForFiles([file, file], '192.168.42.1').length, 2)
assert.throws(
  () => cameraPathsForFile({ ...file, sourceUrl: 'http://example.com/DCIM/IMG.jpg' }, '192.168.42.1'),
  /不属于当前连接的相机/,
)
assert.throws(
  () => cameraPathsForFile({ ...file, sourceUrl: 'http://192.168.42.1/private/IMG.jpg' }, '192.168.42.1'),
  /不在相机媒体目录/,
)
assert.throws(() => cameraPathsForFile(file, 'bad host/path'), /相机地址无效/)

console.log('Insta360 delete codec and path validation tests passed.')
