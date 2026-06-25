import { shell } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { cacheDir, previewCacheDir } from './settingsService'
import type { CacheStats } from '../src/shared/types'

export async function revealFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath)
    shell.showItemInFolder(filePath)
  } catch {
    await shell.openPath(path.dirname(filePath))
  }
}

export async function openPath(targetPath: string): Promise<void> {
  // 如果是 HTTP/HTTPS URL，用默认浏览器打开
  if (/^https?:\/\//i.test(targetPath)) {
    await shell.openExternal(targetPath)
    return
  }
  await fs.mkdir(targetPath, { recursive: true })
  await shell.openPath(targetPath)
}

export async function deleteLocalFiles(filePaths: string[]): Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }> }> {
  const deleted: string[] = []
  const failed: Array<{ path: string; error: string }> = []
  const uniquePaths = [...new Set(filePaths.filter(Boolean))]

  for (const filePath of uniquePaths) {
    try {
      const stats = await fs.lstat(filePath)
      if (!stats.isFile()) {
        failed.push({ path: filePath, error: '只能删除文件' })
        continue
      }
      await fs.rm(filePath, { force: true })
      deleted.push(filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ path: filePath, error: message })
    }
  }

  return { deleted, failed }
}

async function walk(dir: string): Promise<{ files: number; bytes: number }> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    let files = 0
    let bytes = 0

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const nested = await walk(entryPath)
        files += nested.files
        bytes += nested.bytes
      } else if (entry.isFile()) {
        files += 1
        bytes += (await fs.stat(entryPath)).size
      }
    }

    return { files, bytes }
  } catch {
    return { files: 0, bytes: 0 }
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  const previewDir = await previewCacheDir()
  const [oldStats, previewStats] = await Promise.all([walk(cacheDir()), walk(previewDir)])
  return { dir: previewDir, files: oldStats.files + previewStats.files, bytes: oldStats.bytes + previewStats.bytes }
}

export async function clearCache(): Promise<CacheStats> {
  const previewDir = await previewCacheDir()
  await Promise.all([
    fs.rm(cacheDir(), { recursive: true, force: true }),
    fs.rm(previewDir, { recursive: true, force: true }),
  ])
  await fs.mkdir(previewDir, { recursive: true })
  return getCacheStats()
}
