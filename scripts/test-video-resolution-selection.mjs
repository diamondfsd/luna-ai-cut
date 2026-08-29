import assert from 'node:assert/strict'
import { selectPrimaryVideoStream, selectVideoFrame } from '../electron/media/videoResolution.ts'
import { normalizeVideoDimensions, resolveVideoExportResolution } from '../src/lib/videoExportResolution.ts'

const streams = [
  {
    codec_type: 'video',
    index: 0,
    width: 3840,
    height: 2160,
    disposition: { attached_pic: 0 },
  },
  {
    codec_type: 'video',
    index: 5,
    width: 960,
    height: 540,
    disposition: { attached_pic: 1 },
  },
]
const frames = [
  { media_type: 'video', stream_index: 5, width: 960, height: 540 },
]

const primary = selectPrimaryVideoStream(streams)
assert.equal(primary?.index, 0)
assert.equal(primary?.width, 3840)
assert.equal(primary?.height, 2160)
assert.equal(selectVideoFrame(frames, primary), undefined, 'does not use an attached thumbnail frame for the primary stream')

assert.deepEqual(
  resolveVideoExportResolution(1728, 3072, '4k'),
  { width: 3840, height: 6826 },
  'portrait 4K output must use even dimensions',
)
assert.deepEqual(
  resolveVideoExportResolution(1728, 3072, '2k'),
  { width: 2560, height: 4550 },
  'portrait 2K output must use even dimensions',
)
assert.deepEqual(
  normalizeVideoDimensions(1921, 1081),
  { width: 1920, height: 1080 },
  'original output must also be normalized for codecs requiring even dimensions',
)

console.log('video resolution stream selection passed')
