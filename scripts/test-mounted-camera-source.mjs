import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const adapterSource = await readFile(new URL('../electron/devices/common/deviceMedia.ts', import.meta.url), 'utf8')
let source = await readFile(new URL('../electron/devices/common/mountedCameraMediaSource.ts', import.meta.url), 'utf8')
source = source
  .replace("import { dialog } from 'electron'", "const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }")
  .replace("import { lunaMediaAdapter } from './deviceMedia'", '')
  .replace("import { deviceDefinitionFor } from './deviceDefaults'", '')
  .replace("import { labelsFor } from './filePathUtils'", '')
  .replace("import { logMainInfo, logMainWarn } from './loggerService'", '')

const stubs = `
const deviceDefinitionFor = (id) => ({ id, name: 'Test Camera' })
const logMainInfo = () => undefined
const logMainWarn = () => undefined
function labelsFor(date) {
  const capturedAt = date.toISOString()
  const day = capturedAt.slice(0, 10)
  const time = capturedAt.slice(11, 16)
  return { capturedAt, dateText: day, timeText: time, groupDay: day, groupHour: day + ' ' + time.slice(0, 2) + ':00' }
}
`
const compiled = ts.transpileModule(`${adapterSource}\n${stubs}\n${source}`, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const mounted = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'luna-mounted-camera-'))
try {
  const mediaDir = path.join(tempRoot, 'DCIM', 'Camera01')
  await mkdir(mediaDir, { recursive: true })
  await Promise.all([
    writeFile(path.join(mediaDir, 'IMG_20260721_120000.jpg'), 'image'),
    writeFile(path.join(mediaDir, 'VID_20260721_120001.mp4'), 'video-original'),
    writeFile(path.join(mediaDir, 'LRV_20260721_120001.lrv'), 'video-preview'),
    writeFile(path.join(mediaDir, 'LIV_20260721_120002.jpg'), 'live-photo-image'),
    writeFile(path.join(mediaDir, 'LIV_20260721_120002.lrv'), 'live-photo-video'),
    writeFile(path.join(mediaDir, 'README.txt'), 'ignore'),
  ])

  const files = await mounted.listMountedCameraFiles(tempRoot, 'luna-ultra')
  assert.equal(files.length, 3, 'LRV files are attached instead of appearing as separate assets')
  const image = files.find((file) => file.name.startsWith('IMG_'))
  const video = files.find((file) => file.kind === 'video')
  const livePhoto = files.find((file) => file.isLivePhoto)
  assert.ok(image?.sourceUrl.startsWith('file:'), 'mounted images use a local source URL')
  assert.equal(image?.downloadFilePath, null, 'mounted images are not marked as downloaded')
  assert.equal(image?.localPath, undefined, 'mounted images remain removable-source assets')
  assert.ok(video?.previewUrl?.endsWith('LRV_20260721_120001.lrv'), 'video uses the related LRV preview')
  assert.equal(video?.downloadName, 'VID_20260721_120001.mp4', 'video download keeps the original file name')
  assert.equal(mounted.MOUNTED_CAMERA_CAPABILITIES.delete, true, 'mounted source deletion is enabled')
  assert.deepEqual(
    await mounted.resolveMountedCameraVolumes(),
    [],
    '未选择相机磁盘时不能自动扫描其他本地磁盘',
  )

  const imagePath = path.join(mediaDir, image.name)
  const imageDelete = await mounted.deleteMountedCameraFiles(tempRoot, [image])
  assert.deepEqual(imageDelete.failed, [], 'mounted image deletion succeeds')
  assert.deepEqual(imageDelete.deleted, [await realpath(path.dirname(imagePath)) + path.sep + image.name], 'mounted image deletion reports the deleted path')
  await assert.rejects(access(imagePath), 'mounted image no longer exists')

  const videoPath = path.join(mediaDir, video.name)
  const previewPath = path.join(mediaDir, video.previewName)
  const videoDelete = await mounted.deleteMountedCameraFiles(tempRoot, [video])
  assert.deepEqual(videoDelete.failed, [], 'mounted video deletion succeeds')
  const resolvedMediaDir = await realpath(mediaDir)
  assert.deepEqual(
    new Set(videoDelete.deleted),
    new Set([path.join(resolvedMediaDir, video.name), path.join(resolvedMediaDir, video.previewName)]),
    'video deletion includes its LRV',
  )
  await assert.rejects(access(videoPath), 'mounted video no longer exists')
  await assert.rejects(access(previewPath), 'related LRV no longer exists')

  const livePhotoImagePath = path.join(mediaDir, livePhoto.name)
  const livePhotoVideoPath = path.join(mediaDir, livePhoto.livePhotoVideoName)
  const livePhotoDelete = await mounted.deleteMountedCameraFiles(tempRoot, [livePhoto])
  assert.deepEqual(livePhotoDelete.failed, [], 'mounted Live Photo deletion succeeds')
  assert.deepEqual(
    new Set(livePhotoDelete.deleted),
    new Set([path.join(resolvedMediaDir, livePhoto.name), path.join(resolvedMediaDir, livePhoto.livePhotoVideoName)]),
    'Live Photo deletion includes its dynamic file',
  )
  await assert.rejects(access(livePhotoImagePath), 'Live Photo image no longer exists')
  await assert.rejects(access(livePhotoVideoPath), 'Live Photo dynamic file no longer exists')

  const emptyFiles = await mounted.listMountedCameraFiles(tempRoot, 'luna-ultra')
  assert.deepEqual(emptyFiles, [], 'an empty connected camera remains readable after deleting its last asset')

  const outsidePath = path.join(tempRoot, 'outside.jpg')
  await writeFile(outsidePath, 'outside')
  const outsideDelete = await mounted.deleteMountedCameraFiles(tempRoot, [{
    ...image,
    sourceUrl: new URL(`file://${outsidePath}`).toString(),
    previewUrl: null,
    livePhotoVideoUrl: null,
  }])
  assert.equal(outsideDelete.deleted.length, 0, 'paths outside camera media roots are not deleted')
  assert.equal(outsideDelete.failed.length, 1, 'rejected outside paths are reported')
  await access(outsidePath)
  await assert.rejects(
    mounted.listMountedCameraFiles(path.join(tempRoot, 'missing'), 'luna-ultra'),
    /相机磁盘已断开|没有找到/,
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('mounted camera source tests passed')
