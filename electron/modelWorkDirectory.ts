import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { cacheDir, getSettings } from './settingsService'

/** Temporary files used while a local model is running stay with the model cache. */
export function modelWorkRootForBaseDir(baseDir: string): string {
  return path.join(cacheDir(baseDir), 'model-work')
}

export async function createModelWorkDirectory(baseDir: string, prefix: string): Promise<string> {
  const root = modelWorkRootForBaseDir(baseDir)
  await mkdir(root, { recursive: true })
  return mkdtemp(path.join(root, `${prefix}-`))
}

export async function createCurrentModelWorkDirectory(prefix: string): Promise<string> {
  return createModelWorkDirectory((await getSettings()).baseDir, prefix)
}
