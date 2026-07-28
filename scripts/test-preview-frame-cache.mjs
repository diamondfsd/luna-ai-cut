import assert from 'node:assert/strict'
import {
  clearStaticPreviewFrames,
  getStaticPreviewFrame,
  setStaticPreviewFrame,
  staticPreviewFrameKey,
} from '../src/components/staticPreviewFrameCache.ts'
import { getPreviewResolution, setPreviewResolution } from '../src/components/previewResolutionCache.ts'

const frame = (value) => ({ width: 1, height: 1, pixels: new Uint8ClampedArray([value, 0, 0, 255]) })

clearStaticPreviewFrames()
for (let index = 0; index < 5; index += 1) setStaticPreviewFrame(`frame-${index}`, frame(index))
assert.equal(getStaticPreviewFrame('frame-0'), undefined)
assert.equal(getStaticPreviewFrame('frame-4')?.pixels[0], 4)

getStaticPreviewFrame('frame-1')
setStaticPreviewFrame('frame-5', frame(5))
assert.equal(getStaticPreviewFrame('frame-2'), undefined)
assert.equal(getStaticPreviewFrame('frame-1')?.pixels[0], 1)

const key = staticPreviewFrameKey([{ filePath: '/tmp/result.png', dstX: 0, dstY: 0, dstW: 1, dstH: 1 }], 1280, 720, 1440)
assert.ok(key?.includes('/tmp/result.png'))
assert.equal(staticPreviewFrameKey([{ filePath: '/tmp/video.mp4', dstX: 0, dstY: 0, dstW: 1, dstH: 1, isVideo: true }], 1280, 720, 1440), null)

setPreviewResolution('/tmp/original.png', { width: 4000, height: 3000 })
assert.deepEqual(getPreviewResolution('/tmp/original.png'), { width: 4000, height: 3000 })

console.log('preview frame cache tests passed')
