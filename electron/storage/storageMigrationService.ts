import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { AppSettings, StorageMigrationResult } from '../../src/shared/types'

type StorageDirectoryKey = 'projects' | 'downloads' | 'exports' | 'luts' | 'cache' | 'previews' | 'metadata' | 'aiSelection'

interface StorageDirectory {
  key: StorageDirectoryKey
  label: string
  source: string
  destination: string
}

interface DirectoryStats {
  files: number
  bytes: number
}

export interface StorageMigrationPlan {
  targetDir: string
  directories: StorageDirectory[]
}

export interface StorageMigrationSources {
  cacheSource?: string
  previewCacheSource?: string
  metadataCacheSource?: string
  aiSelectionCacheSource?: string
}

export interface StorageMigrationOptions {
  overwriteExisting?: boolean
}

function localResourcesDir(settings: AppSettings): string {
  return settings.localResourcesDir || path.join(settings.baseDir, 'localResources')
}

function exportDir(settings: AppSettings): string {
  return settings.exportDir || path.join(settings.baseDir, 'export')
}

function lutDir(settings: AppSettings): string {
  return settings.lutDir || path.join(settings.baseDir, 'luts')
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isSameOrNested(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function assertTargetDirectory(sourceBaseDir: string, targetDir: string): void {
  if (!targetDir.trim() || !path.isAbsolute(targetDir)) throw new Error('请选择新的本地存储位置')
  const source = comparablePath(sourceBaseDir)
  const target = comparablePath(targetDir)
  if (source === target) throw new Error('新的本地存储位置与当前目录相同')
  if (isSameOrNested(source, target) || isSameOrNested(target, source)) {
    throw new Error('新的本地存储位置不能位于当前目录内')
  }
}

export function createStorageMigrationPlan(
  settings: AppSettings,
  targetDir: string,
  sources: StorageMigrationSources = {},
): StorageMigrationPlan {
  assertTargetDirectory(settings.baseDir, targetDir)
  const target = path.resolve(targetDir)
  const plan: StorageMigrationPlan = {
    targetDir: target,
    directories: [
      {
        key: 'projects',
        label: '工作台项目',
        source: path.resolve(settings.baseDir, 'workspace-projects'),
        destination: path.join(target, 'workspace-projects'),
      },
      {
        key: 'downloads',
        label: '已下载素材',
        source: path.resolve(localResourcesDir(settings)),
        destination: path.join(target, 'localResources'),
      },
      {
        key: 'exports',
        label: '导出内容',
        source: path.resolve(exportDir(settings)),
        destination: path.join(target, 'export'),
      },
      {
        key: 'luts',
        label: 'LUT',
        source: path.resolve(lutDir(settings)),
        destination: path.join(target, 'luts'),
      },
      {
        key: 'cache',
        label: '缓存',
        source: path.resolve(sources.cacheSource ?? path.join(settings.baseDir, 'cache')),
        destination: path.join(target, 'cache'),
      },
      ...(sources.previewCacheSource ? [{
        key: 'previews' as const,
        label: '预览缓存',
        source: path.resolve(sources.previewCacheSource),
        destination: path.join(target, 'cache', 'previews'),
      }] : []),
      ...(sources.metadataCacheSource ? [{
        key: 'metadata' as const,
        label: '素材信息缓存',
        source: path.resolve(sources.metadataCacheSource),
        destination: path.join(target, 'cache', 'metadata'),
      }] : []),
      ...(sources.aiSelectionCacheSource ? [{
        key: 'aiSelection' as const,
        label: '智能选片缓存',
        source: path.resolve(sources.aiSelectionCacheSource),
        destination: path.join(target, 'cache', 'ai-selection'),
      }] : []),
    ],
  }
  for (const directory of plan.directories) {
    const source = comparablePath(directory.source)
    const destination = comparablePath(directory.destination)
    if (source === destination) continue
    if (isSameOrNested(source, destination) || isSameOrNested(destination, source)) {
      throw new Error('新的本地存储位置与现有内容重叠，请选择其他位置')
    }
  }
  return plan
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.lstat(directory)).isDirectory()
  } catch {
    return false
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch {
    return false
  }
}

export async function storageMigrationConflictLabels(plan: StorageMigrationPlan): Promise<string[]> {
  const conflicts = await Promise.all(plan.directories.map(async (directory) => (
    await directoryExists(directory.source) && await pathExists(directory.destination) ? directory.label : null
  )))
  return conflicts.filter((label): label is string => Boolean(label))
}

/** 在复制前确认目录可创建、写入和清理，避免迁移中途才发现目标磁盘不可用。 */
export async function assertStorageTargetWritable(targetDir: string): Promise<void> {
  const target = path.resolve(targetDir)
  const probeDir = path.join(target, `.luna-storage-check-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const probeFile = path.join(probeDir, 'write-check.tmp')
  try {
    await fs.mkdir(target, { recursive: true })
    await fs.mkdir(probeDir)
    await fs.writeFile(probeFile, 'Luna AI Cut storage check', { flag: 'wx' })
    await fs.rm(probeFile)
    await fs.rmdir(probeDir)
  } catch {
    throw new Error('所选位置无法写入，请更换其他基础目录')
  } finally {
    await fs.rm(probeDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function directoryStats(directory: string): Promise<DirectoryStats> {
  const total: DirectoryStats = { files: 0, bytes: 0 }
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await directoryStats(entryPath)
      total.files += nested.files
      total.bytes += nested.bytes
    } else {
      const stats = await fs.lstat(entryPath)
      total.files += 1
      total.bytes += stats.size
    }
  }
  return total
}

function sameStats(left: DirectoryStats, right: DirectoryStats): boolean {
  return left.files === right.files && left.bytes === right.bytes
}

async function copiedDirectoryMatches(source: string, destination: string): Promise<boolean> {
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    let destinationStats: Awaited<ReturnType<typeof fs.lstat>>
    try {
      destinationStats = await fs.lstat(destinationPath)
    } catch {
      return false
    }
    if (entry.isDirectory()) {
      if (!destinationStats.isDirectory() || !await copiedDirectoryMatches(sourcePath, destinationPath)) return false
      continue
    }
    const sourceStats = await fs.lstat(sourcePath)
    if (destinationStats.isDirectory() || destinationStats.size !== sourceStats.size) return false
  }
  return true
}

function remapPath(value: string, mappings: StorageDirectory[]): string {
  if (!path.isAbsolute(value)) return value
  const resolved = path.resolve(value)
  for (const mapping of mappings) {
    if (!isSameOrNested(mapping.source, resolved)) continue
    const relative = path.relative(mapping.source, resolved)
    return relative ? path.join(mapping.destination, relative) : mapping.destination
  }
  return value
}

function remapProjectValue(value: unknown, mappings: StorageDirectory[]): unknown {
  if (typeof value === 'string') return remapPath(value, mappings)
  if (Array.isArray(value)) return value.map((item) => remapProjectValue(item, mappings))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remapProjectValue(item, mappings)]),
  )
}

async function rewriteWorkspaceProjectPaths(plan: StorageMigrationPlan): Promise<void> {
  const projects = plan.directories.find((directory) => directory.key === 'projects')
  if (!projects || !await directoryExists(projects.destination)) return
  const entries = await fs.readdir(projects.destination, { withFileTypes: true })
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const projectPath = path.join(projects.destination, entry.name, 'project.json')
    try {
      const raw = await fs.readFile(projectPath, 'utf8')
      const project = JSON.parse(raw) as unknown
      const remapped = remapProjectValue(project, plan.directories)
      await fs.writeFile(projectPath, `${JSON.stringify(remapped, null, 2)}\n`, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error('无法更新项目中的素材位置')
    }
  }))
}

async function removeCopiedDirectories(directories: StorageDirectory[]): Promise<void> {
  await Promise.all(directories.map((directory) => fs.rm(directory.destination, { recursive: true, force: true })))
}

export async function migrateLocalStorage(
  settings: AppSettings,
  targetDir: string,
  save: (patch: Partial<AppSettings>) => Promise<AppSettings>,
  sources: StorageMigrationSources = {},
  options: StorageMigrationOptions = {},
): Promise<StorageMigrationResult> {
  const plan = createStorageMigrationPlan(settings, targetDir, sources)
  await assertStorageTargetWritable(plan.targetDir)
  const overwriteExisting = options.overwriteExisting === true
  const existingDirectories = (await Promise.all(plan.directories.map(async (directory) => (
    comparablePath(directory.source) !== comparablePath(directory.destination) && await directoryExists(directory.source)
      ? directory
      : null
  )))).filter((directory): directory is StorageDirectory => Boolean(directory))

  const existingDestinations = new Set((await Promise.all(existingDirectories.map(async (directory) => (
    await pathExists(directory.destination) ? directory.key : null
  )))).filter((key): key is StorageDirectoryKey => Boolean(key)))
  if (existingDestinations.size > 0 && !overwriteExisting) {
    throw new Error('新位置已有内容，请确认覆盖后继续')
  }

  const sourceStats = new Map<string, DirectoryStats>()
  for (const directory of existingDirectories) sourceStats.set(directory.key, await directoryStats(directory.source))

  try {
    for (const directory of existingDirectories) {
      await fs.mkdir(path.dirname(directory.destination), { recursive: true })
      await fs.cp(directory.source, directory.destination, {
        recursive: true,
        force: overwriteExisting,
        errorOnExist: !overwriteExisting,
        dereference: false,
      })
      if (!await copiedDirectoryMatches(directory.source, directory.destination)) {
        throw new Error(`无法完整复制“${directory.label}”`)
      }
    }

    await rewriteWorkspaceProjectPaths(plan)

    for (const directory of existingDirectories) {
      const currentStats = await directoryStats(directory.source)
      if (!sameStats(sourceStats.get(directory.key)!, currentStats)) {
        throw new Error('迁移期间文件发生变化，请稍后重试')
      }
    }

    const nextSettings = await save({
      baseDir: plan.targetDir,
      localResourcesDir: plan.directories.find((directory) => directory.key === 'downloads')!.destination,
      exportDir: plan.directories.find((directory) => directory.key === 'exports')!.destination,
      lutDir: plan.directories.find((directory) => directory.key === 'luts')!.destination,
    })

    let oldDataRemoved = true
    for (const directory of existingDirectories) {
      try {
        await fs.rm(directory.source, { recursive: true, force: true })
      } catch {
        oldDataRemoved = false
      }
    }

    return {
      settings: nextSettings,
      targetDir: plan.targetDir,
      movedDirectories: existingDirectories.map((directory) => directory.key),
      oldDataRemoved,
    }
  } catch (error) {
    await removeCopiedDirectories(existingDirectories.filter((directory) => !existingDestinations.has(directory.key)))
    throw error
  }
}
