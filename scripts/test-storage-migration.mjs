import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { assertStorageTargetWritable, migrateLocalStorage } from '../electron/storage/storageMigrationService.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-storage-migration-'))
try {
  const oldBaseDir = path.join(root, 'old', 'LunaAI-Cut')
  const targetDir = path.join(root, 'new', 'LunaAI-Cut')
  const localResourcesDir = path.join(oldBaseDir, 'localResources')
  const exportDir = path.join(oldBaseDir, 'export')
  const lutDir = path.join(oldBaseDir, 'luts')
  const cacheDir = path.join(oldBaseDir, 'cache')
  const logDir = path.join(oldBaseDir, 'logs')
  const legacyMetadataDir = path.join(root, 'legacy', 'cache_metadata')
  const legacyAiSelectionDir = path.join(root, 'legacy', 'ai-selection')
  const projectDir = path.join(oldBaseDir, 'workspace-projects', 'project-1')
  const sourceFile = path.join(localResourcesDir, 'clip.mp4')
  const removalFile = path.join(projectDir, 'removal', 'mask.pgm')

  await Promise.all([
    fs.mkdir(path.dirname(sourceFile), { recursive: true }),
    fs.mkdir(path.dirname(removalFile), { recursive: true }),
    fs.mkdir(exportDir, { recursive: true }),
    fs.mkdir(lutDir, { recursive: true }),
    fs.mkdir(path.join(cacheDir, 'previews'), { recursive: true }),
    fs.mkdir(logDir, { recursive: true }),
    fs.mkdir(legacyMetadataDir, { recursive: true }),
    fs.mkdir(legacyAiSelectionDir, { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(sourceFile, 'downloaded-media'),
    fs.writeFile(removalFile, 'mask-data'),
    fs.writeFile(path.join(exportDir, 'clip.mp4'), 'exported-media'),
    fs.writeFile(path.join(lutDir, 'favorite.cube'), 'TITLE "favorite"'),
    fs.writeFile(path.join(cacheDir, 'previews', 'clip-preview.mp4'), 'preview-data'),
    fs.writeFile(path.join(logDir, 'main.log'), 'log-data'),
    fs.writeFile(path.join(legacyMetadataDir, 'clip.json'), 'metadata-data'),
    fs.writeFile(path.join(legacyAiSelectionDir, 'session.json'), 'selection-data'),
    fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify({
      id: 'project-1',
      dir: projectDir,
      assets: [{ id: 'asset-1', name: 'clip.mp4', path: sourceFile, kind: 'video' }],
      creative: { onlyYourColor: { maskPath: removalFile } },
    }, null, 2)),
  ])

  const settings = {
    baseDir: oldBaseDir,
    localResourcesDir,
    exportDir,
    cacheDir,
    cameraHost: '192.168.42.1',
  }
  const result = await migrateLocalStorage(
    settings,
    targetDir,
    async (patch) => ({ ...settings, ...patch }),
    { metadataCacheSource: legacyMetadataDir, aiSelectionCacheSource: legacyAiSelectionDir },
  )

  const newSourceFile = path.join(targetDir, 'localResources', 'clip.mp4')
  const newRemovalFile = path.join(targetDir, 'workspace-projects', 'project-1', 'removal', 'mask.pgm')
  const migratedProject = JSON.parse(await fs.readFile(path.join(targetDir, 'workspace-projects', 'project-1', 'project.json'), 'utf8'))
  assert.equal(await fs.readFile(newSourceFile, 'utf8'), 'downloaded-media', '已下载素材应迁移到新的目录')
  assert.equal(await fs.readFile(path.join(targetDir, 'export', 'clip.mp4'), 'utf8'), 'exported-media', '导出内容应迁移到新的目录')
  assert.equal(await fs.readFile(path.join(targetDir, 'luts', 'favorite.cube'), 'utf8'), 'TITLE "favorite"', 'LUT 应迁移到新的目录')
  assert.equal(await fs.readFile(path.join(targetDir, 'cache', 'previews', 'clip-preview.mp4'), 'utf8'), 'preview-data', '缓存应迁移到新的目录')
  assert.equal(await fs.readFile(path.join(targetDir, 'cache', 'metadata', 'clip.json'), 'utf8'), 'metadata-data', '素材信息缓存应迁移到新的目录')
  assert.equal(await fs.readFile(path.join(targetDir, 'cache', 'ai-selection', 'session.json'), 'utf8'), 'selection-data', '智能选片缓存应迁移到新的目录')
  await assert.rejects(fs.access(path.join(targetDir, 'logs', 'main.log')), '运行日志不应参与迁移')
  assert.equal(migratedProject.dir, path.join(targetDir, 'workspace-projects', 'project-1'), '项目目录引用应更新')
  assert.equal(migratedProject.assets[0].path, newSourceFile, '项目素材引用应更新')
  assert.equal(migratedProject.creative.onlyYourColor.maskPath, newRemovalFile, '项目内的相关文件引用应更新')
  assert.equal(result.settings.baseDir, targetDir, '基础目录设置应更新')
  assert.equal(result.settings.localResourcesDir, path.join(targetDir, 'localResources'), '下载目录设置应更新')
  assert.equal(result.oldDataRemoved, true, '完成迁移后应清理旧数据')
  await assert.rejects(fs.access(sourceFile), '迁移完成后旧下载素材应被清理')
  await assert.rejects(fs.access(removalFile), '迁移完成后旧项目文件应被清理')
  await assert.rejects(fs.access(path.join(cacheDir, 'previews', 'clip-preview.mp4')), '迁移完成后旧缓存应被清理')
  await assert.rejects(fs.access(path.join(legacyMetadataDir, 'clip.json')), '迁移完成后旧素材信息缓存应被清理')
  await assert.rejects(fs.access(path.join(legacyAiSelectionDir, 'session.json')), '迁移完成后旧智能选片缓存应被清理')
  assert.equal(await fs.readFile(path.join(logDir, 'main.log'), 'utf8'), 'log-data', '运行日志应保留在原位置')

  const occupiedTarget = path.join(root, 'occupied')
  await fs.mkdir(path.join(occupiedTarget, 'localResources'), { recursive: true })
  const occupiedSourceFile = path.join(occupiedTarget, 'localResources', 'clip.mp4')
  const preservedFile = path.join(occupiedTarget, 'localResources', 'keep.txt')
  await fs.writeFile(occupiedSourceFile, 'older-media')
  await fs.writeFile(preservedFile, 'keep-me')
  await assert.rejects(
    () => migrateLocalStorage(result.settings, occupiedTarget, async (patch) => ({ ...result.settings, ...patch })),
    /确认覆盖/,
    '未确认时不能覆盖目标目录已有内容',
  )
  const merged = await migrateLocalStorage(
    result.settings,
    occupiedTarget,
    async (patch) => ({ ...result.settings, ...patch }),
    {},
    { overwriteExisting: true },
  )
  assert.equal(await fs.readFile(occupiedSourceFile, 'utf8'), 'downloaded-media', '确认覆盖后同名素材应替换为迁移内容')
  assert.equal(await fs.readFile(preservedFile, 'utf8'), 'keep-me', '目标目录中不重名的文件应保留')
  assert.equal(merged.oldDataRemoved, true, '合并迁移后应清理旧位置')

  const nonWritableTarget = path.join(root, 'not-a-directory')
  await fs.writeFile(nonWritableTarget, 'file')
  await assert.rejects(
    () => assertStorageTargetWritable(nonWritableTarget),
    /无法写入/,
    '目标不是可写目录时不能开始迁移',
  )
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

console.log('storage migration tests passed')
