/* global Buffer */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildDjiDeletePayload } from '../electron/devices/dji/djiDeleteCodec.ts'
import { openMockSession } from './helpers/djiMockSession.mjs'

test('DJI delete strict UDP removes catalog entries without deleting fixture files', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'luna-dji-delete-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const media = [
    { path: 'DCIM/100MEDIA/test.MP4', thumbPath: 'MISC/THM/100MEDIA/test.scr', handle: 0x40000001, sizeBytes: 10, durationSeconds: 1, storage: 1, resolution: '1920x1080', fps: 25 },
    { path: 'DCIM/100MEDIA/other.MP4', thumbPath: 'MISC/THM/100MEDIA/other.scr', handle: 0x40000002, sizeBytes: 10, durationSeconds: 1, storage: 1, resolution: '1920x1080', fps: 25 },
  ]
  const fixture = path.join(root, media[0].path)
  await mkdir(path.dirname(fixture), { recursive: true })
  await writeFile(fixture, 'mock media')
  const session = await openMockSession(t, { media, mediaRoot: root })
  const mediaUrl = session.baseUrl + '/v2?storage=1&path=' + encodeURIComponent(media[0].path)
  const before = await fetch(mediaUrl)
  assert.equal(before.status, 200)
  assert.equal(await before.text(), 'mock media')

  const issueDelete = (payload) => session.issue({ cmdSet: 0, cmdId: 0x28, payload })
  // Keep upstream's captured variant; do not teach the Mock to accept our client.
  const validPayload = Buffer.alloc(18)
  validPayload[0] = 1
  validPayload.writeUInt32LE(media[0].handle, 1)
  validPayload.writeUInt32LE(1, 5)
  validPayload.set([1, 1], 10)

  const invalidPayload = Buffer.from(validPayload)
  invalidPayload[17] = 1
  assert.deepEqual(await issueDelete(invalidPayload), Buffer.from([0xdf]))
  assert.equal(session.server.state.media.length, 2)

  // This explicitly exposes the existing client/upstream wire disagreement.
  const clientPayload = buildDjiDeletePayload([media[0].handle], 1)
  assert.notDeepEqual(clientPayload, validPayload)
  assert.deepEqual(await issueDelete(clientPayload), Buffer.from([0xdf]))
  assert.equal(session.server.state.media.length, 2)

  assert.deepEqual(await issueDelete(validPayload), Buffer.from([0]))
  assert.deepEqual(session.server.state.media.map((file) => file.handle), [media[1].handle])
  assert.deepEqual(await session.replay(), Buffer.from([0]))
  assert.equal(session.server.state.media.length, 1)
  assert.equal(session.server.metrics.duplicatePackets, 1)
  const after = await fetch(mediaUrl)
  assert.equal(after.status, 404)
  await after.text()
  const thumbnail = await fetch(session.baseUrl + '/v2?storage=1&path=' + encodeURIComponent(media[0].thumbPath))
  assert.equal(thumbnail.status, 404)
  await thumbnail.text()
  assert.equal(await readFile(fixture, 'utf8'), 'mock media')

  assert.deepEqual(await issueDelete(validPayload), Buffer.from([0xd9]))
  assert.equal(session.server.state.media.length, 1)
})
