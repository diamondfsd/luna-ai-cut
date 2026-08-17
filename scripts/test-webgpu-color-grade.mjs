import assert from 'node:assert/strict'

const {
  buildWebGpuColorCurveLut,
  evaluateWebGpuCurve,
  normalizeWebGpuHslChannels,
  webGpuColorCurveCacheKey,
  WEBGPU_CURVE_LUT_WIDTH,
} = await import('../src/lib/webgpu/color-grade.ts')

const identity = buildWebGpuColorCurveLut(undefined)
assert.equal(identity.length, WEBGPU_CURVE_LUT_WIDTH * 4)
assert.equal(identity[0], 0)
assert.equal(identity[(WEBGPU_CURVE_LUT_WIDTH - 1) * 4], 255)
assert.equal(identity[3], 0)
assert.equal(identity[(WEBGPU_CURVE_LUT_WIDTH - 1) * 4 + 3], 255)

const curve = [{ x: 0, y: 0 }, { x: 0.25, y: 0.1 }, { x: 0.75, y: 0.9 }, { x: 1, y: 1 }]
assert.ok(evaluateWebGpuCurve(curve, 0.25) < 0.15)
assert.ok(evaluateWebGpuCurve(curve, 0.75) > 0.85)
const curvedLut = buildWebGpuColorCurveLut({ rgb: curve, luminance: [], red: [], green: [], blue: [] })
assert.ok(curvedLut[64 * 4] < 64)
assert.ok(curvedLut[192 * 4] > 192)
assert.notEqual(
  webGpuColorCurveCacheKey({ rgb: curve, luminance: [], red: [], green: [], blue: [] }),
  webGpuColorCurveCacheKey(undefined),
)

const hsl = normalizeWebGpuHslChannels([
  { hue: -30, hueShift: 12, saturation: -20, luminance: 8 },
])
assert.equal(hsl.length, 12 * 4)
assert.equal(hsl[0], 330)
assert.equal(hsl[1], 12)
assert.equal(hsl[2], -20)
assert.equal(hsl[3], 8)
assert.equal(hsl[4], 0)

console.log('WebGPU color-grade logic checks passed')
