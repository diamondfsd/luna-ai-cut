import assert from 'node:assert/strict'
import {
  activeRemovalOperation,
  deleteRemovalOperation,
  latestReadyRemovalOperation,
  setRemovalOperationEnabled,
} from '../src/workspace/removal/removalOperations.ts'

const operation = (id, inputRevision) => ({
  id,
  enabled: true,
  maskPath: `${id}.mask`,
  maskWidth: 2,
  maskHeight: 2,
  resultPath: `${id}.png`,
  inputRevision,
  edgeExpansion: 4,
  feather: 2,
  model: { id: 'big-lama-fp32', version: 'carve-c3c0c9e', sha256: 'a'.repeat(64) },
  status: 'ready',
  createdAt: '2026-07-29T00:00:00.000Z',
})

const operations = [operation('first', 'source.png'), operation('second', 'first.png'), operation('third', 'second.png')]
const disabled = setRemovalOperationEnabled(operations, 'second', false)
assert.equal(disabled[1].enabled, false)
assert.equal(disabled[2].status, 'needs-regeneration')
assert.equal(activeRemovalOperation(disabled)?.id, 'third')
assert.equal(latestReadyRemovalOperation(disabled)?.id, 'first')

const deleted = deleteRemovalOperation(operations, 'first')
assert.deepEqual(deleted.map((item) => item.id), ['second', 'third'])
assert.equal(deleted.every((item) => item.status === 'needs-regeneration'), true)
assert.equal(setRemovalOperationEnabled(deleted, 'second', true), deleted, '失效步骤不得直接重新启用')

console.log('removal operation tests passed')
