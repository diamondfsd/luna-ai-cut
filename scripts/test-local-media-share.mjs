import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseByteRange, startLocalMediaShareServer } from '../electron/localMediaShareServer.ts'

const tempDir = await mkdtemp(join(tmpdir(), 'luna-local-share-'))
const assetsDir = join(process.cwd(), 'public', 'local-share')
const localPath = join(tempDir, 'local.jpg')
const exportPath = join(tempDir, 'export.mp4')
const sharedDirectory = join(tempDir, 'shared-folder')
const nestedDirectory = join(sharedDirectory, 'nested')
const sharedTextPath = join(sharedDirectory, 'notes.anything')
const nestedFilePath = join(nestedDirectory, 'nested.bin')
const draggedFilePath = join(tempDir, 'dragged.data')
const addedDraggedFilePath = join(tempDir, 'added.data')
let uploadNumber = 0
let sharedRoots = [
  { id: 'shared-folder', name: 'shared-folder', directoryPath: sharedDirectory },
  { id: 'shared-files', name: '拖入的文件', filePaths: [draggedFilePath] },
]

await mkdir(nestedDirectory, { recursive: true })
await Promise.all([
  writeFile(localPath, Buffer.from('local-image-bytes')),
  writeFile(exportPath, Buffer.from('0123456789abcdef')),
  writeFile(sharedTextPath, Buffer.from('shared-file-bytes')),
  writeFile(nestedFilePath, Buffer.from('nested-file-bytes')),
  writeFile(draggedFilePath, Buffer.from('dragged-file-bytes')),
  writeFile(addedDraggedFilePath, Buffer.from('added-file-bytes')),
])

assert.deepEqual(parseByteRange(undefined, 16), null)
assert.deepEqual(parseByteRange('bytes=2-5', 16), { start: 2, end: 5 })
assert.deepEqual(parseByteRange('bytes=-4', 16), { start: 12, end: 15 })
assert.equal(parseByteRange('bytes=20-30', 16), 'invalid')

const server = await startLocalMediaShareServer({
  address: '127.0.0.1',
  assetsDir,
  thumbnail: async () => Buffer.from('thumbnail'),
  sharedFileRoots: async () => sharedRoots,
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
  upload: async (request, fileName) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    uploadNumber += 1
    const uploadedPath = join(tempDir, `uploaded-${uploadNumber}.jpg`)
    await writeFile(uploadedPath, Buffer.concat(chunks))
    return {
      id: `uploaded-${uploadNumber}`,
      source: 'local',
      absolutePath: uploadedPath,
      name: fileName,
      mimeType: 'image/jpeg',
      size: Buffer.concat(chunks).length,
      createdAt: 300 + uploadNumber,
      previewKind: 'image',
    }
  },
})

try {
  const page = await fetch(server.url)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  assert.match(await page.text(), /Luna AI Cut 手机访问/)

  const css = await fetch(new URL('app.css', server.url))
  assert.equal(css.status, 200)
  assert.match(css.headers.get('content-type') ?? '', /text\/css/)

  const actionsCss = await fetch(new URL('app-actions.css', server.url))
  assert.equal(actionsCss.status, 200)
  assert.match(await actionsCss.text(), /upload-button/)

  const list = await fetch(new URL('api/resources?source=export&limit=10', server.url))
  assert.equal(list.status, 200)
  const listBody = await list.json()
  assert.equal(listBody.total, 1)
  assert.deepEqual(listBody.items.map((item) => item.id), ['export-one'])
  assert.equal('absolutePath' in listBody.items[0], false)

  const fileRoots = await fetch(new URL('api/files', server.url))
  assert.equal(fileRoots.status, 200)
  const fileRootsBody = await fileRoots.json()
  assert.deepEqual(fileRootsBody.roots.map((root) => root.id), ['shared-folder', 'shared-files'])
  assert.equal('directoryPath' in fileRootsBody.roots[0], false)

  const sharedList = await fetch(new URL('api/files?root=shared-folder', server.url))
  assert.equal(sharedList.status, 200)
  const sharedListBody = await sharedList.json()
  assert.deepEqual(sharedListBody.items.map((item) => [item.kind, item.name]), [
    ['directory', 'nested'],
    ['file', 'notes.anything'],
  ])
  assert.equal(sharedListBody.items.some((item) => 'absolutePath' in item), false)

  const nestedList = await fetch(new URL('api/files?root=shared-folder&path=nested', server.url))
  assert.equal(nestedList.status, 200)
  const nestedListBody = await nestedList.json()
  assert.equal(nestedListBody.items[0].name, 'nested.bin')
  const nestedDownload = await fetch(new URL(`file-download/${encodeURIComponent(nestedListBody.items[0].id)}`, server.url))
  assert.equal(nestedDownload.status, 200)
  assert.equal(await nestedDownload.text(), 'nested-file-bytes')

  const draggedList = await fetch(new URL('api/files?root=shared-files', server.url))
  const draggedListBody = await draggedList.json()
  assert.equal(draggedListBody.items[0].name, 'dragged.data')
  const draggedDownload = await fetch(new URL(`file-download/${encodeURIComponent(draggedListBody.items[0].id)}`, server.url))
  assert.equal(draggedDownload.status, 200)
  assert.match(draggedDownload.headers.get('content-disposition') ?? '', /dragged\.data/)
  assert.equal(await draggedDownload.text(), 'dragged-file-bytes')

  sharedRoots = [
    { id: 'shared-folder', name: 'shared-folder', directoryPath: sharedDirectory },
    { id: 'shared-files', name: '拖入的文件', filePaths: [draggedFilePath, addedDraggedFilePath] },
  ]
  const updatedDraggedList = await fetch(new URL('api/files?root=shared-files', server.url))
  assert.equal((await updatedDraggedList.json()).total, 2)

  const traversal = await fetch(new URL('api/files?root=shared-folder&path=../', server.url))
  assert.equal(traversal.status, 400)

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

  const uploaded = await fetch(new URL('api/upload', server.url), {
    method: 'POST',
    headers: { 'X-File-Name': encodeURIComponent('手机上传.jpg'), 'Content-Type': 'image/jpeg' },
    body: 'uploaded-image-bytes',
  })
  assert.equal(uploaded.status, 201)
  const uploadedBody = await uploaded.json()
  assert.equal(uploadedBody.item.id, 'uploaded-1')

  const uploadedList = await fetch(new URL('api/resources?source=local&limit=10', server.url))
  const uploadedListBody = await uploadedList.json()
  assert.equal(uploadedListBody.total, 2)

  const zipResponse = await fetch(new URL('download-zip?id=local-one&id=export-one&id=uploaded-1', server.url))
  assert.equal(zipResponse.status, 200)
  assert.equal(zipResponse.headers.get('content-type'), 'application/zip')
  const zip = new AdmZip(Buffer.from(await zipResponse.arrayBuffer()))
  assert.deepEqual(zip.getEntries().map((entry) => entry.entryName).sort(), ['本地图片.jpg', '导出视频.mp4', '手机上传.jpg'].sort())
  assert.equal(zip.getEntry('本地图片.jpg').getData().toString(), 'local-image-bytes')
  assert.equal(zip.getEntry('手机上传.jpg').getData().toString(), 'uploaded-image-bytes')

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
