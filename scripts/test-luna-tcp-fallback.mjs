#!/usr/bin/env node
import assert from 'node:assert/strict'

import { parseLunaFilePaths } from '../electron/lunaMediaIndex.ts'

const files = parseLunaFilePaths([
  '/storage_internal/DCIM/Camera01/VID_20260721_142305_00_001.mp4',
  '/storage_internal/DCIM/Camera01/LRV_20260721_142305_00_001.lrv',
  '/storage_internal/DCIM/Camera01/IMG_20260721_142400_001.jpg',
  '/storage_internal/DCIM/Camera01/IMG_20260721_142400_001.jpg',
  '/storage_internal/DCIM/Camera01/ignored.txt',
], 'http://192.168.42.1/')

assert.equal(files.length, 2)

const video = files.find((file) => file.name.startsWith('VID_'))
assert.ok(video)
assert.equal(video.previewName, 'LRV_20260721_142305_00_001.lrv')
assert.equal(video.previewUrl, 'http://192.168.42.1/storage_internal/DCIM/Camera01/LRV_20260721_142305_00_001.lrv')
assert.equal(video.sourceUrl, 'http://192.168.42.1/storage_internal/DCIM/Camera01/VID_20260721_142305_00_001.mp4')
assert.equal(video.capturedAt, new Date(2026, 6, 21, 14, 23, 5).toISOString())

const image = files.find((file) => file.name.startsWith('IMG_'))
assert.ok(image)
assert.equal(image.dateText, '2026-07-21')
assert.equal(image.timeText, '14:24')
assert.equal(image.bytes, null)

const encoded = parseLunaFilePaths([
  '/DCIM/Camera01/IMG_20260721_150000_%E6%B5%8B%E8%AF%95.jpg',
], 'http://127.0.0.1:18080/')
assert.equal(encoded[0]?.name, 'IMG_20260721_150000_测试.jpg')
assert.equal(encoded[0]?.sourceUrl, 'http://127.0.0.1:18080/DCIM/Camera01/IMG_20260721_150000_%E6%B5%8B%E8%AF%95.jpg')

console.log('Luna TCP fallback media mapping tests passed')
