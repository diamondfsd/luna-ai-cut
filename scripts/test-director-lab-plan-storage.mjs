import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  planWithDownloadedTake,
  reconcileLocalDirectorPlan,
  writeDirectorPlanFiles,
} from '../electron/features/director-lab/directorLabPlanStorage.ts'
import {
  buildDirectorPlanUpdate,
  directorPlanContentSignature,
  directorPlanHasSameShots,
  directorPlanConflictDetails,
  nextDirectorPlanBaseline,
} from '../src/lib/directorPlanSync.ts'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'director-plan-storage-'))
const legacyDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'director-plan-reconcile-'))
const syncDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'director-plan-sync-'))

try {
  const plan = {
    id: 'plan-1',
    title: 'Plan',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    shot_count: 1,
    completed_shot_count: 0,
    take_count: 2,
    archive_url: '',
    source: 'remote',
    attributes: [{ id: 'framing', name: '画面说明' }],
    shots: [{
      id: 'shot-1',
      order: 1,
      name: 'Walk',
      attributes: [{ id: 'framing', name: '画面说明', description: '中景' }],
      remark: '注意收音',
      duration_ms: 5000,
      completed_takes: 0,
      takes: [
        {
          id: 'take-1',
          kind: 'video',
          created_at: '2026-01-01T00:00:00.000Z',
          file_name: 'first.mp4',
          mime_type: 'video/mp4',
          size_bytes: 10,
          available: false,
          selected_range: null,
          stream_path: null,
          stream_url: null,
          download_path: null,
          download_url: null,
        },
        {
          id: 'take-2',
          kind: 'video',
          created_at: '2026-01-01T00:00:00.000Z',
          file_name: 'second.mp4',
          mime_type: 'video/mp4',
          size_bytes: 10,
          available: false,
          selected_range: null,
          stream_path: null,
          stream_url: null,
          download_path: null,
          download_url: null,
        },
      ],
    }],
  }

  const metadataOnly = { ...plan, id: 'plan-no-media', title: 'Metadata only', shots: [] }
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, metadataOnly), true)
  const metadataManifest = JSON.parse(await fs.readFile(
    path.join(syncDirectory, 'Metadata only', 'manifest.json'), 'utf8',
  ))
  assert.equal(metadataManifest.plan_id, 'plan-no-media')
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, metadataOnly), false)

  const localPlan = planWithDownloadedTake(plan, 'take-2')
  await writeDirectorPlanFiles(directory, localPlan)

  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.format, 'luna-director-plan-v1')
  assert.equal(manifest.shots[0].media[0].path, null)
  assert.equal(manifest.shots[0].media[1].path, 'media/01_Walk/02_second.mp4')
  assert.deepEqual(manifest.attributes, [{ id: 'framing', name: '画面说明' }])
  assert.equal(manifest.synced_signature, directorPlanContentSignature(plan))
  assert.equal(manifest.synced_revision, plan.revision ?? 0)
  assert.equal(manifest.shots[0].remark, '注意收音')
  assert.equal(plan.shots[0].takes[1].available, false, 'marking a local take must not mutate the remote plan')
  const syncPlanDirectory = path.join(syncDirectory, 'Plan')
  await writeDirectorPlanFiles(syncPlanDirectory, localPlan)
  const localMediaPath = path.join(syncPlanDirectory, 'media', '01_Walk', '02_second.mp4')
  await fs.mkdir(path.dirname(localMediaPath), { recursive: true })
  await fs.writeFile(localMediaPath, 'downloaded')

  const localManifestPath = path.join(syncPlanDirectory, 'manifest.json')
  const locallyEdited = { ...manifest, title: 'Local edit' }
  await fs.writeFile(localManifestPath, JSON.stringify(locallyEdited, null, 2), 'utf8')
  assert.equal(
    await reconcileLocalDirectorPlan(syncDirectory, plan),
    false,
    'a same-revision local edit must not be overwritten by remote reconciliation',
  )
  assert.equal(JSON.parse(await fs.readFile(localManifestPath, 'utf8')).title, 'Local edit')
  assert.equal(locallyEdited.synced_signature, directorPlanContentSignature(plan))
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, plan, {}, true), true)
  const backupFiles = (await fs.readdir(syncPlanDirectory)).filter((file) => file.startsWith('manifest.conflict-'))
  assert.equal(backupFiles.length, 1)
  assert.equal(JSON.parse(await fs.readFile(path.join(syncPlanDirectory, backupFiles[0]), 'utf8')).title, 'Local edit')
  const resolved = JSON.parse(await fs.readFile(localManifestPath, 'utf8'))
  assert.equal(resolved.title, plan.title)
  assert.equal(resolved.synced_signature, directorPlanContentSignature(plan))
  assert.equal(await fs.readFile(localMediaPath, 'utf8'), 'downloaded')

  await fs.writeFile(localManifestPath, JSON.stringify({ ...resolved, revision: 99, title: 'Newer local' }))
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, plan), false)
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, plan, {}, true), true)
  assert.equal(JSON.parse(await fs.readFile(localManifestPath, 'utf8')).revision, plan.revision ?? 0)

  const remotelyUpdatedPlan = {
    ...plan,
    title: 'Remote edit',
    revision: (plan.revision ?? 0) + 1,
    updated_at: '2026-01-02T00:00:00.000Z',
  }
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, remotelyUpdatedPlan), true)
  const renamedManifestPath = path.join(syncDirectory, 'Remote edit', 'manifest.json')
  assert.equal(JSON.parse(await fs.readFile(renamedManifestPath, 'utf8')).title, 'Remote edit')
  await fs.access(path.join(syncDirectory, 'Remote edit', 'media', '01_Walk', '02_second.mp4'))
  const renamedShotPlan = {
    ...remotelyUpdatedPlan,
    shots: remotelyUpdatedPlan.shots.map((shot) => ({ ...shot, name: 'Renamed shot' })),
  }
  assert.equal(await reconcileLocalDirectorPlan(syncDirectory, renamedShotPlan, {}, true), true)
  const renamedShotManifest = JSON.parse(await fs.readFile(renamedManifestPath, 'utf8'))
  assert.equal(renamedShotManifest.shots[0].media[1].available, true)
  assert.equal(await fs.readFile(path.join(syncDirectory, 'Remote edit', 'media', '01_Renamed shot', '02_second.mp4'), 'utf8'), 'downloaded')
  assert.equal(await fs.readFile(path.join(syncDirectory, 'Remote edit', 'media', '01_Walk', '02_second.mp4'), 'utf8'), 'downloaded')

  const localEquivalent = {
    ...plan,
    source: 'local',
    shots: plan.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) => ({ ...take, available: true })),
    })),
  }
  assert.equal(
    directorPlanContentSignature(localEquivalent),
    directorPlanContentSignature(plan),
    'media availability must not create a plan metadata sync conflict',
  )
  const editedPlan = {
    ...plan,
    shots: plan.shots.map((shot, index) => index === 0 ? { ...shot, remark: '更新后的备注' } : shot),
  }
  assert.notEqual(directorPlanContentSignature(editedPlan), directorPlanContentSignature(plan))
  assert.equal(directorPlanHasSameShots(plan, editedPlan), true)
  assert.equal(directorPlanHasSameShots(plan, { ...editedPlan, shots: [] }), false)
  assert.deepEqual(directorPlanConflictDetails(plan, editedPlan), [{
    label: 'Walk · 备注', remote: '注意收音', local: '更新后的备注',
  }])
  const update = buildDirectorPlanUpdate(editedPlan, 7)
  assert.equal(update.expected_revision, 7)
  assert.equal(update.shots[0].remark, '更新后的备注')
  assert.deepEqual(nextDirectorPlanBaseline(plan, localEquivalent), {
    revision: plan.revision ?? 0,
    remoteSignature: directorPlanContentSignature(plan),
    localSignature: directorPlanContentSignature(localEquivalent),
  })

  const legacyMedia = path.join(legacyDirectory, 'Plan', 'media', '01_Walk', '01_first.mp4')
  await fs.mkdir(path.dirname(legacyMedia), { recursive: true })
  await fs.writeFile(legacyMedia, 'downloaded')
  assert.equal(await reconcileLocalDirectorPlan(legacyDirectory, plan), true)
  assert.equal(await reconcileLocalDirectorPlan(legacyDirectory, plan), false)
  const recovered = JSON.parse(await fs.readFile(path.join(legacyDirectory, 'Plan', 'manifest.json'), 'utf8'))
  assert.equal(recovered.shots[0].media[0].path, 'media/01_Walk/01_first.mp4')
  assert.equal(recovered.shots[0].media[1].path, null)
} finally {
  await fs.rm(directory, { recursive: true, force: true })
  await fs.rm(legacyDirectory, { recursive: true, force: true })
  await fs.rm(syncDirectory, { recursive: true, force: true })
}

console.log('director lab plan storage tests passed')
