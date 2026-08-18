import { app } from 'electron'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { getSettings } from './settingsService'
import { RUNTIME_RESOURCE_DEFINITIONS } from './runtimeResourceDefinitions'
import { getRuntimeResourceCachePath, loadRuntimeResource } from './runtimeResourceService'

const MAX_LUT_FILE_BYTES = 32 * 1024 * 1024

function isWithin(root: string, target: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
  const relative = path.relative(normalizedRoot, normalizedTarget)
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
}

function developmentLutDirectory(): string {
  return path.join(
    process.env.VITE_PUBLIC || process.env.APP_ROOT || path.join(import.meta.dirname, '..'),
    'luts',
  )
}

async function existingBuiltinLutDirectories(): Promise<string[]> {
  const candidates = [
    path.join(process.resourcesPath || '', 'luts'),
    developmentLutDirectory(),
  ]
  const cached = await getRuntimeResourceCachePath(
    path.join(app.getPath('userData'), 'resource-packs'),
    RUNTIME_RESOURCE_DEFINITIONS.luts,
  )
  if (cached) candidates.push(cached)

  const directories: string[] = []
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) directories.push(candidate)
    } catch {
      // Skip unavailable resource roots.
    }
  }
  return directories
}

function relativeBuiltinPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  const prefix = 'luts/'
  if (!path.isAbsolute(filePath) && normalized.startsWith(prefix)) return normalized.slice(prefix.length)
  return null
}

async function resolveAllowedLutPath(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.cube') {
    throw new Error('LUT 文件路径无效')
  }

  const settings = await getSettings()
  const customRoot = path.resolve(settings.lutDir || path.join(settings.baseDir, 'luts'))
  const builtinRoots = await existingBuiltinLutDirectories()
  const relative = relativeBuiltinPath(filePath)
  if (relative && builtinRoots.length === 0) {
    const downloadedRoot = await loadRuntimeResource(
      path.join(app.getPath('userData'), 'resource-packs'),
      RUNTIME_RESOURCE_DEFINITIONS.luts,
    )
    builtinRoots.push(downloadedRoot)
  }
  const candidate = relative
    ? path.join(builtinRoots[0]!, ...relative.split('/'))
    : path.resolve(filePath)

  const [target, targetInfo] = await Promise.all([realpath(candidate), lstat(candidate)]).catch(() => {
    throw new Error('LUT 文件不存在')
  })
  if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) throw new Error('LUT 文件无效')

  const roots = await Promise.all([customRoot, ...builtinRoots].map(async (root) => {
    try {
      return await realpath(root)
    } catch {
      return null
    }
  }))
  if (!roots.some((root) => root && isWithin(root, target))) {
    throw new Error('LUT 文件不在应用允许的目录中')
  }
  return target
}

export async function readWebGpuLutFile(filePath: string): Promise<{ path: string; text: string }> {
  const resolvedPath = await resolveAllowedLutPath(filePath)
  const info = await lstat(resolvedPath)
  if (info.size > MAX_LUT_FILE_BYTES) throw new Error('LUT 文件过大，无法用于实时渲染')
  return { path: resolvedPath, text: await readFile(resolvedPath, 'utf8') }
}
