import { spawn } from 'node:child_process'
import { join } from 'node:path'

import type { NasRemoteFile, NasShare, NasSyncSettings } from '../../src/shared/types'

export interface NasRemoteStat {
  size: number
  isDirectory: boolean
}

export interface NasTransport {
  listShares(): Promise<NasShare[]>
  probe(remotePath?: string): Promise<string[]>
  listFiles(remotePath: string): Promise<NasRemoteFile[]>
  ensureDirectory(remotePath: string): Promise<void>
  stat(remotePath: string): Promise<NasRemoteStat | null>
  copyFile(sourcePath: string, remotePath: string, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<void>
  rename(sourcePath: string, targetPath: string): Promise<void>
  remove(remotePath: string): Promise<void>
  close(): void
}

type SmbWorkerOperation =
  | 'list-shares'
  | 'list-directory'
  | 'stat'
  | 'ensure-directory'
  | 'copy-file'
  | 'rename'
  | 'remove'

interface SmbWorkerOptions {
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
}

interface SmbWorkerError extends Error {
  code?: string
}

type SmbWorkerEnv = NodeJS.ProcessEnv

function smbWorkerPath(): string {
  const executable = process.platform === 'win32' ? 'luna-smb2-worker.exe' : 'luna-smb2-worker'
  if (process.env.LUNA_SMB_WORKER_PATH) return process.env.LUNA_SMB_WORKER_PATH
  const root = process.env.APP_ROOT ?? process.cwd()
  return join(root, 'luna-render-core', executable)
}

function serverHost(value: string): string {
  return value
    .trim()
    .replace(/^smb:\/\//i, '')
    .replace(/^\\+/, '')
    .split(/[\\/]/, 1)[0]
    .trim()
}

function workerErrorCode(message: string): string {
  const status = message.match(/STATUS_[A-Z0-9_]+/)?.[0]
  if (status) return status
  if (/connection refused|os error 61/i.test(message)) return 'ECONNREFUSED'
  if (/timed? out|timeout/i.test(message)) return 'ETIMEDOUT'
  if (/connection reset/i.test(message)) return 'ECONNRESET'
  if (/broken pipe/i.test(message)) return 'EPIPE'
  if (/host is unreachable|no route to host/i.test(message)) return 'EHOSTUNREACH'
  if (/network is unreachable/i.test(message)) return 'ENETUNREACH'
  if (/disconnected|connection closed/i.test(message)) return 'STATUS_CONNECTION_DISCONNECTED'
  return ''
}

function createWorkerError(message: string): SmbWorkerError {
  const error = new Error(message) as SmbWorkerError
  error.name = 'SmbWorkerError'
  error.code = workerErrorCode(message)
  return error
}

function connectionEnv(config: NasSyncSettings): SmbWorkerEnv {
  return {
    ...process.env,
    LUNA_SMB_HOST: serverHost(config.server),
    LUNA_SMB_PORT: String(config.port),
    LUNA_SMB_USER: config.username,
    LUNA_SMB_PASSWORD: config.password,
    LUNA_SMB_SHARE: config.share.trim(),
  } as SmbWorkerEnv
}

async function runSmbWorker<T>(
  operation: SmbWorkerOperation,
  env: SmbWorkerEnv,
  options: SmbWorkerOptions = {},
): Promise<T> {
  const child = spawn(smbWorkerPath(), [operation], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  let stdout = ''
  let stderr = ''
  let lastLine = ''
  const consumeLine = (line: string): void => {
    if (!line) return
    lastLine = line
    options.onStdoutLine?.(line)
  }
  const abort = (): void => {
    child.kill()
  }

  options.signal?.addEventListener('abort', abort, { once: true })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    const lines = stdout.split('\n')
    stdout = lines.pop() ?? ''
    for (const line of lines) consumeLine(line.trim())
  })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    consumeLine(stdout.trim())
    if (options.signal?.aborted) throw new Error('NAS 同步已取消')
    if (exitCode !== 0) {
      throw createWorkerError(stderr.trim() || `Rust SMB worker exited with code ${exitCode ?? 'unknown'}`)
    }
    return lastLine ? JSON.parse(lastLine) as T : undefined as T
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }
}

export function nasErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  if ('code' in error && error.code) return String(error.code).toUpperCase()
  const message = error instanceof Error ? error.message : String(error)
  return workerErrorCode(message)
}

export function nasErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return nasErrorCode(error) || String(error)
}

export function isRemotePathMissing(error: unknown): boolean {
  const code = nasErrorCode(error)
  return code === 'STATUS_OBJECT_NAME_NOT_FOUND'
    || code === 'STATUS_OBJECT_PATH_NOT_FOUND'
    || code === 'STATUS_NO_SUCH_FILE'
}

function workerPath(remotePath: string): string {
  return remotePath.replace(/\\/g, '/')
}

function entryName(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value
}

interface SmbDirectoryEntry {
  name: string
  size: number
  isDirectory: boolean
}

export class SmbTransport implements NasTransport {
  private readonly config: NasSyncSettings

  constructor(config: NasSyncSettings) {
    this.config = config
  }

  private run<T>(operation: SmbWorkerOperation, extraEnv: Partial<SmbWorkerEnv> = {}, options?: SmbWorkerOptions): Promise<T> {
    return runSmbWorker<T>(operation, { ...connectionEnv(this.config), ...extraEnv }, options)
  }

  async listShares(): Promise<NasShare[]> {
    return this.run<NasShare[]>('list-shares')
  }

  async probe(remotePath = ''): Promise<string[]> {
    const entries = await this.run<SmbDirectoryEntry[]>('list-directory', {
      LUNA_SMB_REMOTE_PATH: workerPath(remotePath),
    })
    return entries
      .filter((entry) => entry.isDirectory)
      .map((entry) => entryName(entry.name))
      .filter((name) => name.length > 0)
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  }

  async listFiles(remotePath: string): Promise<NasRemoteFile[]> {
    const entries = await this.run<SmbDirectoryEntry[]>('list-directory', {
      LUNA_SMB_REMOTE_PATH: workerPath(remotePath),
    })
    return entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({ name: entryName(entry.name), size: Number(entry.size ?? 0) }))
      .filter((entry) => entry.name.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    await this.run('ensure-directory', { LUNA_SMB_REMOTE_PATH: workerPath(remotePath) })
  }

  async stat(remotePath: string): Promise<NasRemoteStat | null> {
    const result = await this.run<NasRemoteStat | null>('stat', {
      LUNA_SMB_REMOTE_PATH: workerPath(remotePath),
    })
    return result ? {
      size: Number(result.size ?? 0),
      isDirectory: result.isDirectory === true,
    } : null
  }

  async copyFile(
    sourcePath: string,
    remotePath: string,
    onProgress: (bytes: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run('copy-file', {
      LUNA_SMB_SOURCE: sourcePath,
      LUNA_SMB_REMOTE_PATH: workerPath(remotePath),
    }, {
      signal,
      onStdoutLine: (line) => {
        try {
          const value = JSON.parse(line) as { bytes?: unknown }
          if (typeof value.bytes === 'number') onProgress(value.bytes)
        } catch {
          // Ignore worker output that is not a progress record.
        }
      },
    })
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    await this.run('rename', {
      LUNA_SMB_REMOTE_PATH: workerPath(sourcePath),
      LUNA_SMB_TARGET_PATH: workerPath(targetPath),
    })
  }

  async remove(remotePath: string): Promise<void> {
    await this.run('remove', { LUNA_SMB_REMOTE_PATH: workerPath(remotePath) })
  }

  close(): void {}
}

function pathParts(remotePath: string): string[] {
  const parts = remotePath.replace(/\\/g, '/').split('/')
  if (parts.some((part) => part === '..' || part.includes('\0'))) throw new Error('NAS 目录无效')
  return parts.filter((part) => part && part !== '.')
}

function remotePathParts(remotePath: string): string[] {
  return pathParts(remotePath).map((part) => part.replace(/[/:*?"<>|]/g, '_'))
}

function joinRemotePath(...parts: string[]): string {
  return parts.flatMap(pathParts).join('\\')
}

export function remoteRootPath(config: NasSyncSettings): string {
  return remotePathParts(config.remotePath).join('\\')
}

export function remoteFilePath(config: NasSyncSettings, relativePath: string): string {
  return joinRemotePath(remoteRootPath(config), relativePath)
}

export function remoteTemporaryPath(targetPath: string, itemId: string): string {
  return `${targetPath}.luna-syncing-${itemId}`
}
