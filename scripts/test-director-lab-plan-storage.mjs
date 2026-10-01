import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  planWithDownloadedTake,
  reconcileLocalDirectorPlan,
  writeDirectorPlanFiles,
} from '../electron/features/director-lab/directorLabPlanStorage.ts'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'director-plan-storage-'))
const legacyDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'director-plan-reconcile-'))

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
    shots: [{
      id: 'shot-1',
      order: 1,
      name: 'Walk',
      attributes: [],
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

  const localPlan = planWithDownloadedTake(plan, 'take-2')
  await writeDirectorPlanFiles(directory, localPlan)

  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.format, 'luna-director-plan-v1')
  assert.equal(manifest.shots[0].media[0].path, null)
  assert.equal(manifest.shots[0].media[1].path, 'media/01_Walk/02_second.mp4')
  assert.equal(plan.shots[0].takes[1].available, false, 'marking a local take must not mutate the remote plan')

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
}

console.log('director lab plan storage tests passed')
