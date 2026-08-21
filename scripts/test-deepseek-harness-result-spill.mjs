import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  externalizeLargeResult,
  MAX_INLINE_RESULT_BYTES,
} from '../electron/deepseekHarnessResultSpill.ts'

const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'luna-harness-result-spill-'))
try {
  const small = { projectId: 'small', tracks: [] }
  assert.deepEqual(await externalizeLargeResult('timeline.inspect_context', small, sessionRoot), small)

  const original = {
    projectId: 'project-1',
    fps: 30,
    tracks: [{ id: 'track-1', type: 'video' }],
    items: Array.from({ length: 4000 }, (_, index) => ({
      id: `item-${index}`,
      label: 'x'.repeat(100),
    })),
    transitions: [],
  }
  const result = await externalizeLargeResult('timeline.inspect_context', original, sessionRoot)
  assert.notDeepEqual(result, original)
  assert.match(result.externalFile.path, /^luna-results\/timeline-inspect_context-[\da-f-]+\.json$/u)
  assert.equal(result.externalFile.format, 'json')
  assert.ok(result.externalFile.bytes > MAX_INLINE_RESULT_BYTES)
  assert.equal(result.summary.collectionCounts.items, original.items.length)
  assert.equal(result.summary.collectionCounts.tracks, original.tracks.length)
  assert.equal(result.summary.scalarFields.projectId, original.projectId)
  assert.equal(JSON.parse(await readFile(path.join(sessionRoot, result.externalFile.path), 'utf8')).items.length, original.items.length)
  assert.equal((await stat(path.join(sessionRoot, result.externalFile.path))).mode & 0o777, 0o600)
  assert.equal((await readdir(path.join(sessionRoot, 'luna-results'))).length, 1)
} finally {
  await rm(sessionRoot, { recursive: true, force: true })
}

console.log('DeepSeek Harness result spill tests passed.')
