import assert from 'node:assert/strict'

import { allocateExportFileName, createExportNameAllocator } from '../src/shared/exportFileName.ts'

assert.equal(allocateExportFileName('IMG_001.jpg', []), 'IMG_001.jpg')
assert.equal(allocateExportFileName('IMG_001.jpg', ['IMG_001.jpg']), 'IMG_001 (1).jpg')
assert.equal(
  allocateExportFileName('IMG_001.jpg', ['IMG_001.jpg', 'IMG_001 (1).jpg']),
  'IMG_001 (2).jpg',
)
assert.equal(allocateExportFileName('video', ['VIDEO']), 'video (1)')
assert.equal(allocateExportFileName('.profile', ['.profile']), '.profile (1)')

const allocate = createExportNameAllocator(['clip.mp4'])
assert.equal(allocate('clip.mp4'), 'clip (1).mp4')
assert.equal(allocate('clip.mp4'), 'clip (2).mp4')
assert.equal(allocate('photo.jpg'), 'photo.jpg')

console.log('export file name checks passed')
