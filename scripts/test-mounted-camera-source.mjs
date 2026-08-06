import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const adapterSource = await readFile(new URL('../electron/deviceMedia.ts', import.meta.url), 'utf8')
let source = await readFile(new URL('../electron/mountedCameraMediaSource.ts', import.meta.url), 'utf8')
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
let outsideRoot = ''
try {
  const mediaDir = path.join(tempRoot, '任意 目录', '一级', '二级', '三级')
  const depthFourDir = path.join(tempRoot, '任意 目录', '一级', '二级', '四级目录')
  const depthFiveDir = path.join(depthFourDir, '五级目录')
  await mkdir(mediaDir, { recursive: true })
  await mkdir(depthFiveDir, { recursive: true })
  await Promise.all([
    writeFile(path.join(tempRoot, 'ROOT_20260721_115959.jpg'), 'root-image'),
    writeFile(path.join(mediaDir, 'IMG_20260721_120000.jpg'), 'image'),
    writeFile(path.join(mediaDir, 'VID_20260721_120001.mp4'), 'video-original'),
    writeFile(path.join(mediaDir, 'LRV_20260721_120001.lrv'), 'video-preview'),
    writeFile(path.join(mediaDir, 'LIV_20260721_120002.jpg'), 'live-photo-image'),
    writeFile(path.join(mediaDir, 'LIV_20260721_120002.lrv'), 'live-photo-video'),
    writeFile(path.join(depthFourDir, 'DEPTH4_20260721_120003.jpg'), 'depth-four-image'),
    writeFile(path.join(depthFiveDir, 'DEPTH5_20260721_120004.jpg'), 'depth-five-image'),
    writeFile(path.join(mediaDir, 'README.txt'), 'ignore'),
  ])

  outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'luna-mounted-camera-outside-'))
  const linkedImage = path.join(outsideRoot, 'LINKED_20260721_120005.jpg')
  await writeFile(linkedImage, 'linked-image')
  await symlink(outsideRoot, path.join(tempRoot, 'linked-directory'), 'dir')

  const files = await mounted.listMountedCameraFiles(tempRoot, 'luna-ultra')
  assert.equal(files.length, 5, 'root through depth-four media are listed and LRV files are attached')
  assert.ok(files.some((file) => file.name.startsWith('ROOT_')), 'volume-root media is discovered')
  assert.ok(files.some((file) => file.name.startsWith('DEPTH4_')), 'depth-four media is discovered')
  assert.ok(!files.some((file) => file.name.startsWith('DEPTH5_')), 'depth-five media is not discovered')
  assert.ok(!files.some((file) => file.name.startsWith('LINKED_')), 'symbolic-link directories are not followed')
  const image = files.find((file) => file.name.startsWith('IMG_'))
  const video = files.find((file) => file.kind === 'video')
  const livePhoto = files.find((file) => file.isLivePhoto)
  assert.ok(image?.sourceUrl.startsWith('file:'), 'mounted images use a local source URL')
  assert.equal(image?.downloadFilePath, null, 'mounted images are not marked as downloaded')
  assert.equal(image?.localPath, undefined, 'mounted images remain removable-source assets')
  assert.ok(video?.previewUrl?.endsWith('LRV_20260721_120001.lrv'), 'video uses the related LRV preview')
  assert.equal(video?.downloadName, 'VID_20260721_120001.mp4', 'video download keeps the original file name')
  assert.equal(mounted.MOUNTED_CAMERA_CAPABILITIES.delete, true, 'mounted source deletion is enabled')

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

  const boundaryFiles = files.filter((file) => file.name.startsWith('ROOT_') || file.name.startsWith('DEPTH4_'))
  const boundaryDelete = await mounted.deleteMountedCameraFiles(tempRoot, boundaryFiles)
  assert.deepEqual(boundaryDelete.failed, [], 'root and depth-four media remain safely deletable')
  assert.equal(boundaryDelete.deleted.length, 2, 'both scan-boundary media files are deleted')

  const emptyFiles = await mounted.listMountedCameraFiles(tempRoot, 'luna-ultra')
  assert.deepEqual(emptyFiles, [], 'an empty connected camera remains readable after deleting its last asset')

  const outsidePath = path.join(depthFiveDir, 'OUTSIDE_20260721_120006.jpg')
  await writeFile(outsidePath, 'outside-depth-five')
  const outsideDelete = await mounted.deleteMountedCameraFiles(tempRoot, [{
    ...image,
    sourceUrl: new URL(`file://${outsidePath}`).toString(),
    previewUrl: null,
    livePhotoVideoUrl: null,
  }])
  assert.equal(outsideDelete.deleted.length, 0, 'paths outside the bounded scan result are not deleted')
  assert.equal(outsideDelete.failed.length, 1, 'unscanned paths are reported')
  await access(outsidePath)
  await assert.rejects(
    mounted.listMountedCameraFiles(path.join(tempRoot, 'missing'), 'luna-ultra'),
    /相机磁盘已断开|没有找到/,
  )
} finally {
  if (outsideRoot) await rm(outsideRoot, { recursive: true, force: true })
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('mounted camera source tests passed')
