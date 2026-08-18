import assert from 'node:assert/strict'

const { encodeWebGpuMaskTexture } = await import('../src/lib/webgpu/mask.ts')

const encoded = encodeWebGpuMaskTexture({
  width: 3,
  height: 1,
  bytes: new Uint8Array([0, 255, 0]),
})

assert.equal(encoded.bytesPerRow, 256)
assert.deepEqual(Array.from(encoded.data.slice(0, 12)), [
  0, 3, 0, 255,
  255, 0, 3, 255,
  0, 3, 0, 255,
])

assert.throws(
  () => encodeWebGpuMaskTexture({ width: 2, height: 2, bytes: new Uint8Array([255]) }),
  /蒙版尺寸或数据无效/,
)

console.log('WebGPU mask logic checks passed')
