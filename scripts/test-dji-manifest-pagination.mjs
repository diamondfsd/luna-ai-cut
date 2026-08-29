import assert from 'node:assert/strict'

import {
  DJI_MANIFEST_PAGE_SIZE,
  hasManifestPageAfter,
  olderManifestCursor,
  seedManifestCursor,
  stepManifestPage,
} from '../electron/devices/dji/djiManifestPagination.ts'

const file = (path, handle, storageId = 'storage_internal') => ({ path, handle, storageId })

const firstPage = [
  file('DCIM/DJI_001/old.mp4', 0x40100040),
  file('DCIM/DJI_001/new.mp4', 0x40100080),
]
assert.equal(seedManifestCursor(firstPage), 0x40100040)
assert.equal(hasManifestPageAfter(DJI_MANIFEST_PAGE_SIZE, 0x40100040), true)
assert.equal(hasManifestPageAfter(DJI_MANIFEST_PAGE_SIZE - 1, 0x40100040), false)

const seen = new Set(firstPage.map((item) => `${item.storageId}:${item.path}`))
const secondPage = [
  file('DCIM/DJI_001/old.mp4', 0x40100040),
  file('DCIM/DJI_001/older.mp4', 0x40100000),
]
assert.equal(olderManifestCursor(0x40100040, secondPage), 0x40100000)
const step = stepManifestPage(0x40100040, secondPage, seen)
assert.deepEqual(step.fresh.map((item) => item.path), ['DCIM/DJI_001/older.mp4'])
assert.equal(step.nextCursor, 0x40100000)
assert.equal(step.moreAvailable, true)

const duplicateStep = stepManifestPage(0x40100000, secondPage, seen)
assert.deepEqual(duplicateStep.fresh, [])
assert.equal(duplicateStep.nextCursor, 0x40100000)
assert.equal(duplicateStep.moreAvailable, false)

const mixedStorage = [
  file('DCIM/DJI_001/clip.mp4', 0x40100010, 'storage_internal'),
  file('DCIM/DJI_001/clip.mp4', 0x00040010, 'sdcard'),
]
assert.equal(seedManifestCursor(mixedStorage), 0x40100010)

console.log('DJI manifest pagination tests passed')
