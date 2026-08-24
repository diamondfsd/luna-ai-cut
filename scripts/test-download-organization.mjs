import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import {
  downloadDestinationFor,
  organizeDownloadedFiles,
} from '../electron/media/downloadStorageService.ts'
import { readSourceRecord, recordDownloadedFileSource } from '../electron/media/mediaSourceManifestService.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-download-organization-'))
const file = (name, capturedAt = null) => ({
  name,
  downloadName: name,
  sourceUrl: `http://camera/${name}`,
  capturedAt,
  groupDay: capturedAt ? capturedAt.slice(0, 10) : '未知日期',
})

try {
  const recordedName = 'VID_20260814_120000.mp4'
  const inferredName = 'IMG_20260814_121000.jpg'
  const unknownName = 'manual-copy.mp4'
  const conflictName = 'VID_20260815_120000.mp4'
  const recordedPath = path.join(root, recordedName)
  const inferredPath = path.join(root, inferredName)
  const unknownPath = path.join(root, unknownName)
  const conflictPath = path.join(root, conflictName)

  await Promise.all([
    fs.writeFile(recordedPath, 'video'),
    fs.writeFile(inferredPath, 'image'),
    fs.writeFile(unknownPath, 'unknown'),
    fs.writeFile(conflictPath, 'conflict-source'),
  ])
  await recordDownloadedFileSource(root, recordedPath, file(recordedName, '2026-08-14T12:00:00.000Z'))

  const destination = downloadDestinationFor(root, file(recordedName, '2026-08-14T12:00:00.000Z'), true)
  assert.equal(destination, path.join(root, '2026-08-14', recordedName), '下载开启按日期整理时应生成日期目录路径')

  const conflictDestination = path.join(root, '2026-08-15', conflictName)
  await fs.mkdir(path.dirname(conflictDestination), { recursive: true })
  await fs.writeFile(conflictDestination, 'existing')

  const result = await organizeDownloadedFiles(root)
  assert.deepEqual(result, { moved: 2, skipped: 2, failed: 0 }, '整理应移动可识别日期的旧文件并保留未知日期和重名文件')
  assert.equal(await fs.readFile(destination, 'utf8'), 'video')
  assert.equal(await fs.readFile(path.join(root, '2026-08-14', inferredName), 'utf8'), 'image')
  assert.equal(await fs.readFile(unknownPath, 'utf8'), 'unknown')
  assert.equal(await fs.readFile(conflictPath, 'utf8'), 'conflict-source')
  assert.equal((await readSourceRecord(root, destination))?.originalName, recordedName, '移动后来源记录应跟随文件路径更新')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

console.log('download organization tests passed')
