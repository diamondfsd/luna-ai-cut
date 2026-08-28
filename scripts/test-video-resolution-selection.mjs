import assert from 'node:assert/strict'
import { selectPrimaryVideoStream, selectVideoFrame } from '../electron/media/videoResolution.ts'

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

console.log('video resolution stream selection passed')
