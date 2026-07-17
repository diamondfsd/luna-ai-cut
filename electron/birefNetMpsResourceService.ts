import { app } from 'electron'
import { access } from 'node:fs/promises'
import path from 'node:path'

import { RUNTIME_RESOURCE_DEFINITIONS } from './runtimeResourceDefinitions.js'
import { loadRuntimeResource, type RuntimeResourceProgress } from './runtimeResourceService.js'
import { mapBiRefNetMpsProgress, type BiRefNetMpsResourceProgress } from './birefNetMpsProgress.js'

export interface BiRefNetMpsResources {
  runtimeRoot: string
  modelRoot: string
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
    onProgress: (progress: RuntimeResourceProgress) => onProgress?.(mapBiRefNetMpsProgress(progress, '运行组件', 0, totalArchiveBytes, runtime.archiveBytes)),
  })
  const modelRoot = await loadRuntimeResource(resourceCacheRoot(), model, {
    ...options,
    onProgress: (progress: RuntimeResourceProgress) => onProgress?.(mapBiRefNetMpsProgress(progress, '主体模型', runtime.archiveBytes, totalArchiveBytes, model.archiveBytes)),
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
