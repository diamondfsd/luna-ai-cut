import {
  VIRTUAL_EDITING_DIRECTORIES,
  VirtualFilesError,
  type VirtualEditingDirectory,
  type VirtualFileKind,
} from './virtual-files-types'

const directorySet = new Set<string>(VIRTUAL_EDITING_DIRECTORIES)

function invalidPath(path: string): never {
  throw new VirtualFilesError(
    'INVALID_PATH',
    `Invalid virtual workspace path: ${JSON.stringify(path)}`,
  )
}

function assertCommonPathRules(path: string): void {
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) {
    invalidPath(path)
  }
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) invalidPath(path)
}

export function validateVirtualFilePath(path: string): VirtualFileKind {
  if (path === 'manifest.json') return 'manifest'
  assertCommonPathRules(path)
  const parts = path.split('/')
  const root = parts[0]
  if (root === undefined) invalidPath(path)
  if (!directorySet.has(root) || parts.length < 2 || !path.endsWith('.json')) invalidPath(path)
  return root as VirtualEditingDirectory
}

export function validateVirtualDirectoryPath(path = ''): string {
  if (path === '') return path
  assertCommonPathRules(path)
  const root = path.split('/')[0]
  if (root === undefined) invalidPath(path)
  if (!directorySet.has(root)) invalidPath(path)
  return path
}

export function virtualFileKind(path: string): VirtualFileKind {
  return validateVirtualFilePath(path)
}

export function isWithinVirtualDirectory(filePath: string, directoryPath: string): boolean {
  return directoryPath === '' || filePath.startsWith(`${directoryPath}/`)
}
