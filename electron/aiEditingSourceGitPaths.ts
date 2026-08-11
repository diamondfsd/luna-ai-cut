import * as nodeFs from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
const MAX_SOURCE_FILE_BYTES = 16 * 1024 * 1024

export const MAX_CHANGE_BATCH_BYTES = 64 * 1024 * 1024

export function sourceContentBytes(content: string): number {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_SOURCE_FILE_BYTES) throw new Error('源码文件超出大小限制')
  return bytes
}

export function validateProjectId(projectId: string): void {
  if (
    typeof projectId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(projectId) ||
    projectId === '.' ||
    projectId === '..' ||
    WINDOWS_DEVICE_NAME.test(projectId)
  ) {
    throw new Error('项目标识无效')
  }
}

export function validateSourcePath(sourcePath: string, allowRoot = false): string {
  if (typeof sourcePath !== 'string' || sourcePath.length > 512 || sourcePath.includes('\\')) {
    throw new Error('源码路径无效')
  }
  if (sourcePath === '') {
    if (allowRoot) return ''
    throw new Error('源码路径无效')
  }
  if (path.posix.isAbsolute(sourcePath) || path.win32.isAbsolute(sourcePath)) {
    throw new Error('源码路径无效')
  }
  const segments = sourcePath.split('/')
  for (const segment of segments) {
    const containsInvalidCharacter = [...segment].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 32 || codePoint === 127 || '<>:"|?*'.includes(character)
    })
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.toLowerCase() === '.git' ||
      WINDOWS_DEVICE_NAME.test(segment) ||
      containsInvalidCharacter ||
      segment.endsWith('.') ||
      segment.endsWith(' ')
    ) {
      throw new Error('源码路径无效')
    }
  }
  return segments.join('/')
}

export function validateBranchName(name: string): void {
  if (
    typeof name !== 'string' ||
    name.length > 100 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.includes('//') ||
    name.includes('..') ||
    name.includes('@{') ||
    name
      .split('/')
      .some(
        (segment) =>
          !segment ||
          segment.startsWith('.') ||
          segment.endsWith('.lock') ||
          WINDOWS_DEVICE_NAME.test(segment),
      )
  ) {
    throw new Error('分支名称无效')
  }
}

export async function ensurePlainDirectory(directory: string, create: boolean): Promise<void> {
  let stat: nodeFs.Stats
  try {
    stat = await fs.lstat(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error
    await fs.mkdir(directory)
    stat = await fs.lstat(directory)
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('剪辑源码目录无效')
}
