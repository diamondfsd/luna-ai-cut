import { app } from 'electron'
import { access } from 'node:fs/promises'
import path from 'node:path'

import { RUNTIME_RESOURCE_DEFINITIONS } from './runtimeResourceDefinitions.js'
import { loadRuntimeResource, type RuntimeResourceProgress } from './runtimeResourceService.js'

export interface BiRefNetMpsResources {
  runtimeRoot: string
  modelRoot: string
}

export interface BiRefNetMpsResourceProgress {
  label: string
  percent: number | null
}

let preparedResources: BiRefNetMpsResources | null = null

export function supportsBiRefNetMpsResources(): boolean {
  return process.platform === 'darwin' && process.arch === 'arm64'
}

function resourceCacheRoot(): string {
  return path.join(app.getPath('userData'), 'runtime-resources')
}

function sevenZipPath(): string {
  const appRoot = process.env.APP_ROOT ?? path.join(import.meta.dirname, '..')
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tools', process.platform === 'win32' ? '7za.exe' : '7za')
    : path.join(appRoot, 'node_modules', '7zip-bin', process.platform === 'win32' ? 'win' : 'mac', process.arch, process.platform === 'win32' ? '7za.exe' : '7za')
}

function mapProgress(
  progress: RuntimeResourceProgress,
  label: string,
  completedArchiveBytes: number,
  totalArchiveBytes: number,
  currentArchiveBytes: number,
): BiRefNetMpsResourceProgress {
  if (progress.phase !== 'download') {
    return {
      label: progress.phase === 'install' ? `正在安装${label}` : `正在校验${label}`,
      percent: null,
    }
  }
  const ratio = progress.totalBytes > 0 ? progress.completedBytes / progress.totalBytes : 0
  return {
    label: `正在下载${label}`,
    percent: Math.round((completedArchiveBytes + currentArchiveBytes * ratio) / totalArchiveBytes * 100),
  }
}

export async function prepareBiRefNetMpsResources(
  onProgress?: (progress: BiRefNetMpsResourceProgress) => void,
  signal?: AbortSignal,
): Promise<BiRefNetMpsResources | null> {
  if (!supportsBiRefNetMpsResources()) return null
  const runtime = RUNTIME_RESOURCE_DEFINITIONS.birefnetMpsRuntime
  const model = RUNTIME_RESOURCE_DEFINITIONS.birefnetMpsModel
  const totalArchiveBytes = runtime.archiveBytes + model.archiveBytes
  const options = { signal, sevenZipPath: sevenZipPath() }
  const runtimeRoot = await loadRuntimeResource(resourceCacheRoot(), runtime, {
    ...options,
    onProgress: (progress) => onProgress?.(mapProgress(progress, '运行组件', 0, totalArchiveBytes, runtime.archiveBytes)),
  })
  const modelRoot = await loadRuntimeResource(resourceCacheRoot(), model, {
    ...options,
    onProgress: (progress) => onProgress?.(mapProgress(progress, '主体模型', runtime.archiveBytes, totalArchiveBytes, model.archiveBytes)),
  })
  await Promise.all([
    access(path.join(runtimeRoot, 'birefnet-mps-worker')),
    access(path.join(runtimeRoot, 'python', 'Python.framework', 'Versions', '3.12', 'bin', 'python3.12')),
    access(path.join(modelRoot, 'model.safetensors')),
    access(path.join(modelRoot, 'config.json')),
  ])
  preparedResources = { runtimeRoot, modelRoot }
  return preparedResources
}

export function getPreparedBiRefNetMpsResources(): BiRefNetMpsResources | null {
  return preparedResources
}
