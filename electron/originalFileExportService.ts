import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

function abortError(): Error {
  const error = new Error('导出已取消')
  error.name = 'AbortError'
  return error
}

export async function exportOriginalFile(
  sourcePath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(outputPath)) {
    throw new Error('原片导出路径无效')
  }
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    throw new Error('原片导出不能覆盖源文件')
  }

  const partialPath = `${outputPath}.partial-${process.pid}-${Date.now()}`
  await mkdir(path.dirname(outputPath), { recursive: true })
  await rm(partialPath, { force: true })

  try {
    if (signal?.aborted) throw abortError()
    await copyFile(sourcePath, partialPath)
    if (signal?.aborted) throw abortError()
    await rename(partialPath, outputPath)
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => {})
    throw error
  }
}
