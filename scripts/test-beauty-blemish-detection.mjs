import assert from 'node:assert/strict'

import { detectFaceBlemishes } from '../electron/beautyBlemishDetection.ts'

const size = 64

function fixture() {
  const rgb = new Uint8Array(size * size * 3)
  const labels = new Uint8Array(size * size)
  labels.fill(1)
  for (let index = 0; index < labels.length; index += 1) {
    rgb[index * 3] = 180
    rgb[index * 3 + 1] = 145
    rgb[index * 3 + 2] = 135
  }
  return { rgb, labels }
}

function paint(rgb, centerX, centerY, color) {
  for (let y = centerY - 1; y <= centerY + 1; y += 1) {
    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      const offset = (y * size + x) * 3
      rgb[offset] = color[0]
      rgb[offset + 1] = color[1]
      rgb[offset + 2] = color[2]
    }
  }
}

const clean = fixture()
assert.deepEqual(
  detectFaceBlemishes(clean.rgb, clean.labels, size),
  {
    acneMask: new Uint8Array(size * size),
    spotMask: new Uint8Array(size * size),
    wrinkleMask: new Uint8Array(size * size),
    acneCount: 0,
    spotCount: 0,
    wrinkleCount: 0,
  },
  'uniform skin must not produce blemishes',
)

const blemished = fixture()
paint(blemished.rgb, 20, 20, [210, 105, 95])
paint(blemished.rgb, 44, 42, [100, 90, 80])
const detected = detectFaceBlemishes(blemished.rgb, blemished.labels, size)
assert.equal(detected.acneCount, 1, 'a compact red anomaly must be classified as acne')
assert.equal(detected.spotCount, 1, 'a compact dark anomaly must be classified as a spot')
assert.ok(detected.acneMask.some((value) => value > 0), 'acne detection must produce a soft mask')
assert.ok(detected.spotMask.some((value) => value > 0), 'spot detection must produce a soft mask')

const wrinkled = fixture()
for (let x = 22; x <= 36; x += 1) paint(wrinkled.rgb, x, 30, [135, 110, 105])
const wrinkleResult = detectFaceBlemishes(wrinkled.rgb, wrinkled.labels, size)
assert.ok(wrinkleResult.wrinkleCount >= 1, 'an elongated dark skin line must be classified as a wrinkle')
assert.ok(wrinkleResult.wrinkleMask.some((value) => value > 0), 'wrinkle detection must produce a soft mask')

const protectedFeature = fixture()
paint(protectedFeature.rgb, 20, 20, [210, 105, 95])
paint(protectedFeature.rgb, 44, 42, [100, 90, 80])
for (let y = 16; y <= 24; y += 1) for (let x = 16; x <= 24; x += 1) protectedFeature.labels[y * size + x] = 10
for (let y = 38; y <= 46; y += 1) for (let x = 40; x <= 48; x += 1) protectedFeature.labels[y * size + x] = 10
const protectedResult = detectFaceBlemishes(protectedFeature.rgb, protectedFeature.labels, size)
assert.equal(protectedResult.acneCount, 0, 'non-skin face labels must be protected from acne correction')
assert.equal(protectedResult.spotCount, 0, 'non-skin face labels must be protected from spot correction')
assert.equal(protectedResult.wrinkleCount, 0, 'non-skin face labels must be protected from wrinkle correction')

console.log('Beauty blemish detection tests passed')
