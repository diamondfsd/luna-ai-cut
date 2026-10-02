import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { reconcileDirectorPlanDeletions } from '../electron/features/director-lab/directorLabPlanDeletion.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'director-plan-deletion-'))
const endpoint = 'http://192.168.1.10:47821'

async function writePlan(id, overrides = {}) {
  const directory = path.join(root, id)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    format: 'luna-director-plan-v1', plan_id: id, shots: [],
    synced_signature: 'saved-baseline', pending_create: false, ...overrides,
  }))
  return directory
}

async function readPlan(id) {
  return JSON.parse(await fs.readFile(path.join(root, id, 'manifest.json'), 'utf8'))
}

try {
  const deletedDirectory = await writePlan('deleted', {
    pending_shot_ids: ['unsynced-shot'], pending_take_ids: ['unsynced-take'],
  })
  const mediaPath = path.join(deletedDirectory, 'first.mp4')
  await fs.writeFile(mediaPath, 'downloaded-material')
  await writePlan('present')
  await writePlan('new-local', { pending_create: true })
  await writePlan('other-phone', { remote_origin: 'http://192.168.1.20:47821' })
  await writePlan('untracked', { synced_signature: null })
  await fs.mkdir(path.join(root, 'invalid'))
  await fs.writeFile(path.join(root, 'invalid', 'manifest.json'), '{')

  assert.deepEqual(await reconcileDirectorPlanDeletions(root, endpoint, ['present']), ['deleted'])
  const deleted = await readPlan('deleted')
  assert.equal(deleted.remote_deleted, true)
  assert.equal(deleted.remote_origin, endpoint)
  assert.ok(Number.isFinite(Date.parse(deleted.remote_deleted_at)))
  assert.deepEqual(deleted.pending_shot_ids, ['unsynced-shot'])
  assert.deepEqual(deleted.pending_take_ids, ['unsynced-take'])
  assert.equal(await fs.readFile(mediaPath, 'utf8'), 'downloaded-material')
  assert.equal((await readPlan('present')).remote_origin, endpoint)
  assert.equal((await readPlan('present')).remote_deleted, undefined)
  assert.equal((await readPlan('new-local')).remote_deleted, undefined)
  assert.equal((await readPlan('other-phone')).remote_deleted, undefined)
  assert.equal((await readPlan('untracked')).remote_deleted, undefined)
  assert.deepEqual(await reconcileDirectorPlanDeletions(root, endpoint, ['present']), [])

  assert.deepEqual(await reconcileDirectorPlanDeletions(root, endpoint, []), ['present'])
  assert.equal((await readPlan('present')).remote_deleted, true)
  assert.equal((await readPlan('new-local')).remote_deleted, undefined)
  assert.deepEqual(await reconcileDirectorPlanDeletions(path.join(root, 'missing'), endpoint, []), [])
  await assert.rejects(() => reconcileDirectorPlanDeletions(root, 'file:///tmp', []))
  await assert.rejects(() => reconcileDirectorPlanDeletions(root, endpoint, [null]))
  console.log('Director plan deletion checks passed')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
