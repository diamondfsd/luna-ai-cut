import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export function friendlyDownloadError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'ENOSPC') return '下载目录空间不足，请清理空间后重试'
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) return '下载目录不可写，请重新选择一个可用目录'
  if (['ENOENT', 'ENODEV', 'EIO'].includes(code)) return '下载目录不可用，请确认移动硬盘已连接后重试'
  return error instanceof Error && error.message ? error.message : '下载失败，请检查下载目录后重试'
}

export async function prepareDownloadDirectory(directory: string): Promise<string> {
  if (!directory.trim() || !path.isAbsolute(directory)) throw new Error('请重新选择下载目录')
  const resolved = path.resolve(directory)
  const probe = path.join(resolved, `.luna-write-check-${randomUUID()}`)
  try {
    await fs.mkdir(resolved, { recursive: true })
    await fs.writeFile(probe, '', { flag: 'wx' })
  } catch (error) {
    throw new Error(friendlyDownloadError(error))
  } finally {
    await fs.rm(probe, { force: true }).catch(() => undefined)
  }
  return resolved
}
