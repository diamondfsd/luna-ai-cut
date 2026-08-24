import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { FileCopyResult } from '../../src/shared/types'

const MAX_COPY_FILES = 1_000

export function sourcePathsForCopy(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const paths = new Set<string>()
  for (const candidate of value.slice(0, MAX_COPY_FILES)) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue
    paths.add(path.normalize(candidate))
  }
  return [...paths]
}

function copyName(name: string, index: number): string {
  if (index === 0) return name
  const extension = path.extname(name)
  const basename = path.basename(name, extension)
  return `${basename} (${index})${extension}`
}

async function copyWithAvailableName(sourcePath: string, destinationDir: string): Promise<void> {
  const sourceName = path.basename(sourcePath)
  for (let index = 0; index < MAX_COPY_FILES; index += 1) {
    const destinationPath = path.join(destinationDir, copyName(sourceName, index))
    try {
      await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('目标文件夹中存在过多同名素材')
}

export async function copyLocalFilesToDirectory(sourcePaths: string[], destinationDir: string): Promise<FileCopyResult> {
  await mkdir(destinationDir, { recursive: true })
  let copiedCount = 0
  let failedCount = 0
  const resolvedDestination = path.resolve(destinationDir)

  for (const sourcePath of sourcePaths) {
    try {
      const resolvedSource = path.resolve(sourcePath)
      if (path.dirname(resolvedSource) === resolvedDestination) throw new Error('不能复制到原文件夹')
      if (!(await stat(resolvedSource)).isFile()) throw new Error('素材文件不可用')
      await copyWithAvailableName(resolvedSource, resolvedDestination)
      copiedCount += 1
    } catch {
      failedCount += 1
    }
  }

  return { destinationDir: resolvedDestination, copiedCount, failedCount }
}
