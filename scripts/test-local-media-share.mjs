import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseByteRange, startLocalMediaShareServer } from '../electron/localMediaShareServer.ts'

const tempDir = await mkdtemp(join(tmpdir(), 'luna-local-share-'))
const assetsDir = join(process.cwd(), 'public', 'local-share')
const localPath = join(tempDir, 'local.jpg')
const exportPath = join(tempDir, 'export.mp4')

await Promise.all([
  writeFile(localPath, Buffer.from('local-image-bytes')),
  writeFile(exportPath, Buffer.from('0123456789abcdef')),
])

assert.deepEqual(parseByteRange(undefined, 16), null)
assert.deepEqual(parseByteRange('bytes=2-5', 16), { start: 2, end: 5 })
assert.deepEqual(parseByteRange('bytes=-4', 16), { start: 12, end: 15 })
assert.equal(parseByteRange('bytes=20-30', 16), 'invalid')

const server = await startLocalMediaShareServer({
  address: '127.0.0.1',
  assetsDir,
  thumbnail: async () => Buffer.from('thumbnail'),
  resources: [
    {
      id: 'local-one',
      source: 'local',
      absolutePath: localPath,
      name: '本地图片.jpg',
      mimeType: 'image/jpeg',
      size: 17,
      createdAt: 100,
      previewKind: 'image',
    },
    {
      id: 'export-one',
      source: 'export',
      absolutePath: exportPath,
      name: '导出视频.mp4',
      mimeType: 'video/mp4',
      size: 16,
      createdAt: 200,
      previewKind: 'video',
    },
  ],
})

try {
  const page = await fetch(server.url)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  assert.match(await page.text(), /Luna AI Cut 手机访问/)

  const css = await fetch(new URL('app.css', server.url))
  assert.equal(css.status, 200)
  assert.match(css.headers.get('content-type') ?? '', /text\/css/)

  const list = await fetch(new URL('api/resources?source=export&limit=10', server.url))
  assert.equal(list.status, 200)
  const listBody = await list.json()
  assert.equal(listBody.total, 1)
  assert.deepEqual(listBody.items.map((item) => item.id), ['export-one'])
  assert.equal('absolutePath' in listBody.items[0], false)

  const thumbnail = await fetch(new URL('thumb/export-one', server.url))
  assert.equal(thumbnail.status, 200)
  assert.equal(await thumbnail.text(), 'thumbnail')

  const ranged = await fetch(new URL('media/export-one', server.url), { headers: { Range: 'bytes=2-5' } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/16')
  assert.equal(await ranged.text(), '2345')

  const download = await fetch(new URL('download/local-one', server.url))
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition') ?? '', /filename\*=UTF-8''/)
  assert.equal(await download.text(), 'local-image-bytes')

  const rejectedMethod = await fetch(server.url, { method: 'POST' })
  assert.equal(rejectedMethod.status, 405)
  const unknown = await fetch(new URL('download/not-allowed', server.url))
  assert.equal(unknown.status, 404)
  const forged = await fetch(server.url.replace(server.token, 'forged-token'))
  assert.equal(forged.status, 404)
} finally {
  await server.stop()
  await rm(tempDir, { recursive: true, force: true })
}

await assert.rejects(fetch(server.url))
console.log('local media share service tests passed')
