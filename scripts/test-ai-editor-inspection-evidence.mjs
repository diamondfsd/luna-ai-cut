import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordInspectionEvidence, assertInspectionEvidence } from '../electron/features/ai-editor/aiEditorInspectionEvidence.ts'
const root = await mkdtemp(path.join(tmpdir(), 'luna-evidence-'))
try {
  const file = path.join(root, 'source.mp4')
  await writeFile(file, 'source')
  await assert.rejects(assertInspectionEvidence('m1', file, [1]))
  await recordInspectionEvidence('m1', file, [1, 3])
  await assertInspectionEvidence('m1', file, [1, 3])
  await assert.rejects(assertInspectionEvidence('m1', file, [2]))
  await assert.rejects(assertInspectionEvidence('m2', file, [1]))
  await recordInspectionEvidence('m1', file, [5])
  await assertInspectionEvidence('m1', file, [1, 5])
  await writeFile(file, 'different source bytes')
  await assert.rejects(assertInspectionEvidence('m1', file, [1]))
  await recordInspectionEvidence('m1', file, [2])
  await assertInspectionEvidence('m1', file, [2])
  await assert.rejects(assertInspectionEvidence('m1', file, [1]))
  console.log('Inspection evidence accumulation, identity isolation and source mutation invalidation passed')
} finally { await rm(root, { recursive: true, force: true }) }
