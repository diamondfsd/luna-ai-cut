import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Dirent } from 'node:fs'

import type { CustomLutFile } from '../src/shared/types/settings'

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
}

async function scanLutDirectory(root: string, directory: string, files: CustomLutFile[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await scanLutDirectory(root, filePath, files)
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.cube') {
      const relativeDirectory = path.relative(root, directory).split(path.sep).join('/')
      files.push({ filePath, fileName: entry.name, relativeDirectory })
    }
  }
}

export async function listCustomLutsInDirectory(directory: string): Promise<CustomLutFile[]> {
  const root = path.resolve(directory)
  const files: CustomLutFile[] = []
  await scanLutDirectory(root, root, files)
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  }) || a.relativeDirectory.localeCompare(b.relativeDirectory, 'zh-CN'))
}

export async function deleteCustomLutInDirectory(directory: string, filePath: string): Promise<void> {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.cube') {
    throw new Error('请选择当前目录中的 LUT 文件')
  }

  const root = path.resolve(directory)
  const resolvedTarget = path.resolve(filePath)
  if (!isWithin(root, resolvedTarget)) throw new Error('这个 LUT 文件不在当前目录中')

  const [realRoot, realTarget, targetInfo] = await Promise.all([
    fs.realpath(root),
    fs.realpath(resolvedTarget),
    fs.lstat(resolvedTarget),
  ]).catch(() => {
    throw new Error('这个 LUT 文件已不存在')
  })
  if (!isWithin(realRoot, realTarget) || !targetInfo.isFile() || targetInfo.isSymbolicLink()) {
    throw new Error('无法删除这个 LUT 文件')
  }

  await fs.rm(resolvedTarget)
  await fs.rm(`${resolvedTarget}.meta.json`, { force: true })
}
