import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { deleteDirectorLocalMaterial } from '../electron/features/director-lab/directorLabMaterialDelete.ts'
import { overlayDirectorLocalPlan, buildDirectorPlanUpdate } from '../src/lib/directorPlanSync.ts'
import { writeDirectorPlanFiles, reconcileLocalDirectorPlan } from '../electron/features/director-lab/directorLabPlanStorage.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'director-material-delete-'))
try {
  const directory = path.join(root, 'plan')
  const mediaDirectory = path.join(directory, '01-shot')
  await fs.mkdir(mediaDirectory, { recursive: true })
  const file = path.join(mediaDirectory, 'clip.mp4')
  const otherFile = path.join(mediaDirectory, 'other.mp4')
  await fs.writeFile(file, 'video')
  await fs.writeFile(otherFile, 'other')
  const take = { id: 'video-1', kind: 'video', available: true, stream_url: pathToFileURL(file).toString(),
    selected_range: { start_ms: 0, end_ms: 5000, note: 'keep note' } }
  const otherTake = { ...take, id: 'video-2', stream_url: pathToFileURL(otherFile).toString() }
  const plan = { id: 'plan-1', title: 'Test', attributes: [], pending_take_ids: [take.id], local_directory: directory,
    shots: [{ id: 'shot-1', name: 'Shot', order: 1, attributes: [], remark: '', duration_ms: 5000, takes: [take, otherTake] }] }
  let persisted
  const next = await deleteDirectorLocalMaterial(plan, take.id, async value => { persisted = value })
  assert.equal(next, persisted)
  await assert.rejects(fs.stat(file), { code: 'ENOENT' })
  assert.equal(await fs.readFile(otherFile, 'utf8'), 'other')
  assert.equal(plan.shots[0].takes[0].available, true)
  assert.equal(next.shots[0].takes[0].available, false)
  assert.equal(next.shots[0].takes[0].stream_url, null)
  assert.deepEqual(next.shots[0].takes[0].selected_range, take.selected_range)
  assert.deepEqual(next.deleted_local_take_ids, [take.id])
  assert.deepEqual(next.pending_take_ids, [])
  assert.deepEqual(buildDirectorPlanUpdate(next, 0).shots[0].take_ranges.map(item => item.id), [otherTake.id])
  assert.equal(overlayDirectorLocalPlan(plan, next).shots[0].takes[0].available, false)
  assert.equal(overlayDirectorLocalPlan(plan, next).shots[0].takes[0].stream_url, null)

  await fs.writeFile(file, 'restore-on-failure')
  await assert.rejects(deleteDirectorLocalMaterial(plan, take.id, async () => { throw new Error('save failed') }), /save failed/)
  assert.equal(await fs.readFile(file, 'utf8'), 'restore-on-failure')
  await fs.unlink(file)
  const missing = await deleteDirectorLocalMaterial(plan, take.id, async () => {})
  assert.equal(missing.shots[0].takes[0].available, false)

  const outside = path.join(root, 'outside.mp4')
  await fs.writeFile(outside, 'do-not-delete')
  await fs.symlink(outside, file)
  await assert.rejects(deleteDirectorLocalMaterial(plan, take.id, async () => {}), /素材目录/)
  assert.equal(await fs.readFile(outside, 'utf8'), 'do-not-delete')
  await assert.rejects(deleteDirectorLocalMaterial(plan, 'unknown', async () => {}), /本地素材/)
  const remote = { ...plan, shots: [{ ...plan.shots[0], takes: [{ ...take, stream_url: 'https://phone/clip.mp4' }] }] }
  await assert.rejects(deleteDirectorLocalMaterial(remote, take.id, async () => {}), /本地素材/)
  const externalDirectory = path.join(root, 'External deletion')
  const externalTake = { ...otherTake, file_name: 'other.mp4', created_at: '', selected_range: null }
  const externalPlan = { ...plan, id: 'external-plan', title: 'External deletion', pending_take_ids: [],
    shots: [{ ...plan.shots[0], takes: [externalTake] }] }
  await writeDirectorPlanFiles(externalDirectory, externalPlan)
  let manifest = JSON.parse(await fs.readFile(path.join(externalDirectory, 'manifest.json'), 'utf8'))
  const externalFile = path.join(externalDirectory, manifest.shots[0].media[0].path)
  await fs.unlink(externalFile)
  await reconcileLocalDirectorPlan(root, externalPlan)
  manifest = JSON.parse(await fs.readFile(path.join(externalDirectory, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.deleted_local_take_ids, [externalTake.id])
  assert.equal(manifest.shots[0].media[0].available, false)
  assert.equal(await reconcileLocalDirectorPlan(root, externalPlan), false)
  await assert.rejects(fs.stat(externalFile), { code: 'ENOENT' })
  console.log('director local material deletion checks passed')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
