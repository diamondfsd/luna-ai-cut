import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

import { friendlyFileOperationError, userFacingFileOperationError } from '../storage/fileOperationDiagnostics.ts'

export function friendlyDownloadError(error: unknown): string {
  return friendlyFileOperationError(error, 'download')
}

export async function prepareDownloadDirectory(directory: string): Promise<string> {
  if (!directory.trim() || !path.isAbsolute(directory)) throw new Error('请重新选择下载目录')
  const resolved = path.resolve(directory)
  const probe = path.join(resolved, `.luna-write-check-${randomUUID()}`)
  try {
    await fs.mkdir(resolved, { recursive: true })
    await fs.writeFile(probe, '', { flag: 'wx' })
  } catch (error) {
    throw userFacingFileOperationError(error, 'download')
  } finally {
    await fs.rm(probe, { force: true }).catch(() => undefined)
  }
  return resolved
}
