import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { friendlyDownloadError, prepareDownloadDirectory } from '../electron/downloadDirectoryService.ts'
import { existingDragFiles } from '../electron/nativeFileDragService.ts'
import { readSourceRecord, recordDownloadedFileSource } from '../electron/mediaSourceManifestService.ts'
import { migrateBaseDirectory } from '../electron/settingsMigration.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-hotfix-files-'))
try {
  const removableLikeDir = path.join(root, '移动硬盘', 'Luna 下载')
  assert.equal(await prepareDownloadDirectory(removableLikeDir), path.resolve(removableLikeDir), 'FILE-DOWNLOAD-P0: 带空格和中文的外部目录应可写')
  assert.deepEqual(await fs.readdir(removableLikeDir), [], 'FILE-DOWNLOAD-P0: 写入探测不应留下临时文件')
  await assert.rejects(() => prepareDownloadDirectory('relative/path'), /重新选择下载目录/, 'FILE-DOWNLOAD-P1: 拒绝非绝对目录')
  assert.equal(friendlyDownloadError({ code: 'ENOSPC' }), '下载目录空间不足，请清理空间后重试')
  assert.equal(friendlyDownloadError({ code: 'EROFS' }), '下载目录不可写，请重新选择一个可用目录')
  assert.equal(friendlyDownloadError({ code: 'ENODEV' }), '下载目录不可用，请确认移动硬盘已连接后重试')
  assert.deepEqual(
    migrateBaseDirectory({ downloadDir: '/legacy/base', localResourcesDir: '/external/media' }, '/default/base'),
    { baseDir: '/legacy/base', localResourcesDir: '/external/media' },
    'SETTINGS-P0: 旧基础目录字段应迁移且不再写回旧字段',
  )
  assert.equal(migrateBaseDirectory({ baseDir: '/new/base', downloadDir: '/legacy/base' }, '/default/base').baseDir, '/new/base', 'SETTINGS-P1: 新字段优先于旧字段')

  const first = path.join(root, 'first.jpg')
  const second = path.join(root, 'second.mp4')
  await Promise.all([fs.writeFile(first, 'image'), fs.writeFile(second, 'video')])
  assert.deepEqual(existingDragFiles([first, first, root, 'relative.jpg', second, path.join(root, 'missing.jpg')]), [first, second], 'FILE-DRAG-P0: 仅拖出存在的绝对文件并去重')

  await Promise.all([
    recordDownloadedFileSource(removableLikeDir, first, { name: 'first.jpg', sourceUrl: 'http://camera/first.jpg' }),
    recordDownloadedFileSource(removableLikeDir, second, { name: 'second.mp4', sourceUrl: 'http://camera/second.mp4' }),
  ])
  assert.equal((await readSourceRecord(removableLikeDir, 'first.jpg'))?.originalName, 'first.jpg', 'FILE-DOWNLOAD-P0: 并发下载不能覆盖第一条来源记录')
  assert.equal((await readSourceRecord(removableLikeDir, 'second.mp4'))?.originalName, 'second.mp4', 'FILE-DOWNLOAD-P0: 并发下载不能丢失第二条来源记录')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

console.log('hotfix file operation tests passed')
