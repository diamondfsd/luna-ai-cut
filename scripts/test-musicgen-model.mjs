import assert from 'node:assert/strict'

const {
  MUSICGEN_MODEL_FILE_DEFINITIONS,
  MUSICGEN_MODEL_ID,
  MUSICGEN_MODEL_INFO,
  isMusicGenModelManifest,
} = await import('../src/shared/musicGenModels.ts')

const files = MUSICGEN_MODEL_FILE_DEFINITIONS.map(({ fileName, sizeBytes, sha256 }) => ({ fileName, sizeBytes, sha256 }))
const manifest = {
  schemaVersion: 1,
  id: MUSICGEN_MODEL_ID,
  version: MUSICGEN_MODEL_INFO.version,
  files,
  license: MUSICGEN_MODEL_INFO.license,
  licenseUrl: MUSICGEN_MODEL_INFO.licenseUrl,
  source: MUSICGEN_MODEL_INFO.source,
  upstreamModel: MUSICGEN_MODEL_INFO.upstreamModel,
}

assert.equal(MUSICGEN_MODEL_FILE_DEFINITIONS.length, 5)
assert.equal(new Set(files.map((file) => file.fileName)).size, 5)
assert.equal(isMusicGenModelManifest(manifest), true)
assert.equal(isMusicGenModelManifest({ ...manifest, files: [{ ...files[0], sizeBytes: files[0].sizeBytes + 1 }, ...files.slice(1)] }), false)
assert.equal(isMusicGenModelManifest({ ...manifest, version: 'unexpected' }), false)
assert.equal(isMusicGenModelManifest({ ...manifest, files: files.slice(0, -1) }), false)

for (const file of MUSICGEN_MODEL_FILE_DEFINITIONS) {
  assert.match(file.sha256, /^[a-f0-9]{64}$/)
  assert.ok(file.sizeBytes > 0)
  assert.match(file.url, /^https:\/\/gitcode\.com\/[^/]+\/[^/]+\/releases\/download\//)
  assert.match(file.upstreamUrl, /^https:\/\/huggingface\.co\//)
}

console.log('MusicGen model metadata tests passed')
