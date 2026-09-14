import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { Writable } from 'node:stream'

import SMB2 from '@marsaud/smb2'
import type { NasSyncSettings } from '../../src/shared/types'

export interface NasRemoteStat {
  size: number
  isDirectory: boolean
}

export interface NasTransport {
  probe(): Promise<void>
  ensureDirectory(remotePath: string): Promise<void>
  stat(remotePath: string): Promise<NasRemoteStat | null>
  copyFile(sourcePath: string, remotePath: string, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<void>
  rename(sourcePath: string, targetPath: string): Promise<void>
  remove(remotePath: string): Promise<void>
  close(): void
}

function serverHost(value: string): string {
  return value
    .trim()
    .replace(/^smb:\/\//i, '')
    .replace(/^\\+/, '')
    .split(/[\\/]/, 1)[0]
    .trim()
}

function shareRoot(config: NasSyncSettings): string {
  const server = serverHost(config.server)
  const share = config.share.trim().replace(/^[/\\]+|[/\\]+$/g, '')
  if (!server || !share || share.includes('..') || share.includes('/') || share.includes('\\')) {
    throw new Error('NAS 共享配置无效')
  }
  return `\\\\${server}\\${share}`
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

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code).toUpperCase() : ''
}

export function isRemotePathMissing(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'STATUS_OBJECT_NAME_NOT_FOUND'
    || code === 'STATUS_OBJECT_PATH_NOT_FOUND'
    || code === 'STATUS_NO_SUCH_FILE'
}

export class SmbTransport implements NasTransport {
  private readonly client: SMB2

  constructor(config: NasSyncSettings) {
    this.client = new SMB2({
      share: shareRoot(config),
      domain: '',
      username: config.username,
      password: config.password,
      autoCloseTimeout: 0,
    })
  }

  async probe(): Promise<void> {
    await this.client.readdir('')
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    const parts = remotePathParts(remotePath)
    let current = ''
    for (const part of parts) {
      current = joinRemotePath(current, part)
      if (await this.stat(current)) continue
      try {
        await this.client.mkdir(current)
      } catch (error) {
        if (!await this.stat(current).catch(() => null)) throw error
      }
    }
  }

  async stat(remotePath: string): Promise<NasRemoteStat | null> {
    try {
      const value = await this.client.stat(remotePathParts(remotePath).join('\\')) as unknown as { size?: number; isDirectory(): boolean }
      return { size: Number(value.size ?? 0), isDirectory: value.isDirectory() }
    } catch (error) {
      if (isRemotePathMissing(error)) return null
      throw error
    }
  }

  async copyFile(
    sourcePath: string,
    remotePath: string,
    onProgress: (bytes: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const source = createReadStream(sourcePath)
    let destination: Writable | null = null
    let completed = false
    let copied = 0
    const onData = (chunk: Buffer): void => {
      copied += chunk.length
      onProgress(copied)
    }
    try {
      destination = await this.client.createWriteStream(remotePathParts(remotePath).join('\\'), { flags: 'w' })
      source.on('data', onData)
      await pipeline(
        source as unknown as NodeJS.ReadableStream,
        destination as unknown as NodeJS.WritableStream,
        { signal },
      )
      completed = true
      onProgress(copied)
    } finally {
      source.off('data', onData)
      if (!completed) {
        source.destroy()
        destination?.destroy()
      }
    }
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    await this.client.rename(remotePathParts(sourcePath).join('\\'), remotePathParts(targetPath).join('\\'))
  }

  async remove(remotePath: string): Promise<void> {
    try {
      await this.client.unlink(remotePathParts(remotePath).join('\\'))
    } catch (error) {
      if (!isRemotePathMissing(error)) throw error
    }
  }

  close(): void {
    this.client.disconnect()
  }
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
