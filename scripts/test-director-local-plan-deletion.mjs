import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { deleteLocalDirectorPlan } from '../electron/features/director-lab/directorLabPlanDeletion.ts'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'director-delete-'))
try {
  const directory = path.join(root, 'plan')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'media.mp4'), 'preserved')
  const plan = { id: 'plan', local_directory: directory, local_content_signature: 'current' }
  let calls = 0
  const trash = async target => { calls++; await fs.rename(target, path.join(root, 'trashed')) }
  await assert.rejects(deleteLocalDirectorPlan(root, 'plan', 'stale', async () => [plan], trash), /计划已更新/)
  await assert.rejects(deleteLocalDirectorPlan(root, 'missing', 'current', async () => [plan], trash), /不存在/)
  await assert.rejects(deleteLocalDirectorPlan(root, 'plan', 'current', async () => [{ ...plan, local_directory: root }], trash), /目录无效/)
  const link = path.join(root, 'link')
  await fs.symlink(os.tmpdir(), link)
  await assert.rejects(deleteLocalDirectorPlan(root, 'plan', 'current', async () => [{ ...plan, local_directory: link }], trash), /目录无效/)
  assert.equal(calls, 0)
  await assert.rejects(deleteLocalDirectorPlan(root, 'plan', 'current', async () => [plan], async () => { throw new Error('trash failed') }), /trash failed/)
  assert.equal(await fs.readFile(path.join(directory, 'media.mp4'), 'utf8'), 'preserved')
  await deleteLocalDirectorPlan(root, 'plan', 'current', async () => [plan], trash)
  assert.equal(calls, 1)
  assert.equal(await fs.readFile(path.join(root, 'trashed', 'media.mp4'), 'utf8'), 'preserved')
  console.log('Director plan deletion checks passed')
} finally { await fs.rm(root, { recursive: true, force: true }) }
