import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const { generateReferenceMatchLut } = await import('../src/workspace/color/referenceMatch.ts')
const { saveReferenceMatchLut } = await import('../electron/features/color/referenceMatchService.ts')

function image(pixels, width = 4) {
  const data = new Uint8Array(pixels.flatMap(([r, g, b]) => [r, g, b, 255]))
  return { width, height: Math.ceil(pixels.length / width), data }
}

function cubeRows(cube) {
  return cube
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-+]?\d*\.\d+\s+[-+]?\d*\.\d+\s+[-+]?\d*\.\d+$/.test(line))
    .map((line) => line.split(/\s+/).map(Number))
}

const source = image([
  [0, 0, 0], [64, 64, 64], [128, 128, 128], [255, 255, 255],
  [255, 0, 0], [0, 255, 0], [0, 0, 255], [192, 128, 64],
])
const identity = generateReferenceMatchLut(source, source, { gridSize: 5, maxSamples: 100 })
const identityRows = cubeRows(identity.cube)
assert.equal(identity.stats.sourceSamples, 8)
assert.equal(identity.stats.referenceSamples, 8)
assert.equal(identityRows.length, 5 ** 3)
assert.ok(identityRows.every((row) => row.length === 3 && row.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)))
assert.ok(identityRows[0].every((value) => value < 0.05), `black corner drifted: ${identityRows[0]}`)
assert.ok(identityRows.at(-1).every((value) => value > 0.95), `white corner drifted: ${identityRows.at(-1)}`)

const warmReference = image([
  [255, 180, 140], [255, 180, 140], [230, 150, 110], [255, 200, 160],
  [230, 150, 110], [255, 200, 160], [255, 180, 140], [230, 150, 110],
])
const matched = generateReferenceMatchLut(source, warmReference, { gridSize: 5, maxSamples: 100, strength: 0.75 })
const matchedRows = cubeRows(matched.cube)
assert.equal(matchedRows.length, 5 ** 3)
assert.ok(matchedRows.some((row, index) => row.some((value) => Math.abs(value - identityRows[index][0]) > 0.02)), 'reference match did not change the LUT')

for (const method of ['reinhard', 'kantorovich', 'forgy', 'wasserstein']) {
  const result = generateReferenceMatchLut(source, warmReference, {
    method,
    gridSize: 5,
    maxSamples: 100,
    nColors: 4,
    nSlices: 4,
  })
  const rows = cubeRows(result.cube)
  assert.equal(result.stats.method, method)
  assert.equal(rows.length, 5 ** 3, `${method} did not generate a complete LUT`)
  assert.ok(rows.every((row) => row.length === 3 && row.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)), `${method} generated an invalid LUT value`)
}

for (const method of ['reinhard', 'kantorovich', 'forgy', 'wasserstein']) {
  const result = generateReferenceMatchLut(source, source, {
    method,
    gridSize: 5,
    maxSamples: 100,
    nColors: 4,
    nSlices: 4,
  })
  const rows = cubeRows(result.cube)
  let maximumIdentityError = 0
  for (let blue = 0; blue < 5; blue += 1) {
    for (let green = 0; green < 5; green += 1) {
      for (let red = 0; red < 5; red += 1) {
        const row = rows[blue * 25 + green * 5 + red]
        maximumIdentityError = Math.max(maximumIdentityError, ...row.map((value, channel) => Math.abs(value - [red, green, blue][channel] / 4)))
      }
    }
  }
  assert.ok(maximumIdentityError < 0.08, `${method} drifted when reference and target were identical`)
}

const storageDir = await mkdtemp(join(tmpdir(), 'luna-reference-match-'))
try {
  const fullSize = generateReferenceMatchLut(source, warmReference, { gridSize: 33, maxSamples: 100 })
  const saved = await saveReferenceMatchLut({ baseDir: storageDir }, {
    cube: fullSize.cube,
    name: '测试参考图追色',
    method: 'reinhard',
    referenceAssetId: 'reference-1',
    referenceName: '参考图.jpg',
    targetAssetId: 'target-1',
    targetName: '目标图.jpg',
  })
  assert.equal((await stat(saved.path)).isFile(), true)
  const metadata = JSON.parse(await readFile(`${saved.path}.meta.json`, 'utf8'))
  assert.equal(metadata.kind, 'reference-match')
  assert.equal(metadata.referenceAssetId, 'reference-1')
} finally {
  await rm(storageDir, { recursive: true, force: true })
}

console.log('reference match algorithm checks passed')
