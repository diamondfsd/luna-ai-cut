import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createWorkspaceProject,
} from '../electron/workspaceProjectService.ts'
import {
  createRemotionClip,
  getRemotionClip,
  listRemotionClips,
  readRemotionSource,
  remotionSourceHash,
  updateRemotionClipAfterRender,
  updateRemotionSource,
} from '../electron/remotionClipService.ts'

const baseDir = await mkdtemp(path.join(os.tmpdir(), 'freecut-remotion-clip-'))
try {
  const project = await createWorkspaceProject(baseDir, 'Remotion clip test', [])
  const initialSource = {
    'src/Root.tsx': 'export default function Root() { return null }\n',
  }
  const clip = await createRemotionClip(baseDir, project.id, {
    width: 640,
    height: 360,
    files: initialSource,
  })
  assert.equal(clip.sourceRevision, 1)
  assert.equal(clip.status, 'dirty')
  assert.equal(clip.sourceHash, remotionSourceHash(initialSource))

  const rendered = await updateRemotionClipAfterRender(baseDir, project.id, clip.clipId, {
    artifactId: 'artifact-1',
    outputPath: 'artifacts/artifact-1.mp4',
    manifestPath: 'artifacts/artifact-1.json',
    sourceRevision: clip.sourceRevision,
    sourceHash: clip.sourceHash,
    fileSize: 10,
    sha256: 'a'.repeat(64),
    mimeType: 'video/mp4',
  }, clip.sourceRevision, clip.sourceHash, 120)
  assert.equal(rendered?.status, 'ready')
  assert.equal(rendered?.durationInFrames, 120)

  const snapshot = await readRemotionSource(baseDir, project.id, clip.clipId)
  assert.deepEqual(snapshot.files, initialSource)
  assert.equal(snapshot.sourceHash, clip.sourceHash)

  const updated = await updateRemotionSource(baseDir, {
    projectId: project.id,
    clipId: clip.clipId,
    expectedRevision: clip.sourceRevision,
    files: { 'src/Root.tsx': 'export default function Root() { return <div /> }\n' },
  })
  assert.equal(updated.sourceRevision, 2)
  assert.notEqual(updated.sourceHash, clip.sourceHash)
  assert.equal(updated.artifact?.artifactId, 'artifact-1')
  await assert.rejects(
    updateRemotionSource(baseDir, {
      projectId: project.id,
      clipId: clip.clipId,
      expectedRevision: 1,
      files: initialSource,
    }),
    /源码版本已变化/u,
  )

  const loaded = await getRemotionClip(baseDir, project.id, clip.clipId)
  assert.equal(loaded?.sourceRevision, 2)
  assert.equal(loaded?.durationInFrames, 120)
  assert.equal((await listRemotionClips(baseDir, project.id)).length, 1)

  const freecutProjectId = 'freecut-project-1'
  const freecutProjectDirectory = path.join(baseDir, 'freecut-workspace', 'projects', freecutProjectId)
  await mkdir(freecutProjectDirectory, { recursive: true })
  await writeFile(path.join(freecutProjectDirectory, 'project.json'), `${JSON.stringify({
    id: freecutProjectId,
    name: 'FreeCut Remotion project',
    description: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    duration: 0,
    schemaVersion: 15,
    metadata: { width: 1080, height: 1920, fps: 30 },
  })}\n`, 'utf8')

  const freecutClip = await createRemotionClip(baseDir, freecutProjectId, {
    width: 1080,
    height: 1920,
    durationInFrames: 90,
    files: initialSource,
  })
  const freecutClipFile = path.join(
    freecutProjectDirectory,
    'remotion-clips',
    freecutClip.clipId,
    'clip.json',
  )
  assert.equal((await stat(freecutClipFile)).isFile(), true)
  assert.equal((await listRemotionClips(baseDir, freecutProjectId)).length, 1)
  console.log('RemotionClip source revision/hash storage passed.')
} finally {
  await rm(baseDir, { recursive: true, force: true })
}
