import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

import { Client as SMB2Client } from 'node-smb2'
import { Client as ShareDiscoveryClient } from 'smb3-client'
import type { NasRemoteFile, NasShare, NasShareType, NasSyncSettings } from '../../src/shared/types'

export interface NasRemoteStat {
  size: number
  isDirectory: boolean
}

export interface NasTransport {
  listShares(): Promise<NasShare[]>
  probe(): Promise<string[]>
  listFiles(remotePath: string): Promise<NasRemoteFile[]>
  ensureDirectory(remotePath: string): Promise<void>
  stat(remotePath: string): Promise<NasRemoteStat | null>
  copyFile(sourcePath: string, remotePath: string, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<void>
  rename(sourcePath: string, targetPath: string): Promise<void>
  remove(remotePath: string): Promise<void>
  close(): void
}

const SMB_STATUS_NAMES: Record<number, string> = {
  0xc0000022: 'STATUS_ACCESS_DENIED',
  0xc0000034: 'STATUS_OBJECT_NAME_NOT_FOUND',
  0xc000003a: 'STATUS_OBJECT_PATH_NOT_FOUND',
  0xc000006d: 'STATUS_LOGON_FAILURE',
  0xc000007f: 'STATUS_DISK_FULL',
  0xc00000cc: 'STATUS_BAD_NETWORK_NAME',
  0xc00000c9: 'STATUS_NETWORK_NAME_DELETED',
  0xc0000120: 'STATUS_CANCELLED',
  0xc000020c: 'STATUS_CONNECTION_DISCONNECTED',
}

export function nasErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  if ('statusName' in error && typeof error.statusName === 'string') {
    const statusName = error.statusName.toUpperCase()
    if (statusName.startsWith('STATUS_')) return statusName
  }
  if ('status' in error) {
    const status = Number(error.status)
    if (Number.isFinite(status)) return SMB_STATUS_NAMES[status] ?? `STATUS_0X${status.toString(16).toUpperCase()}`
  }
  if ('header' in error) {
    const header = error.header
    if (header && typeof header === 'object' && 'status' in header) {
      const status = Number(header.status)
      if (Number.isFinite(status)) return SMB_STATUS_NAMES[status] ?? `STATUS_0X${status.toString(16).toUpperCase()}`
    }
  }
  if ('code' in error) return String(error.code).toUpperCase()
  return ''
}

export function nasErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return nasErrorCode(error) || String(error)
}

function serverHost(value: string): string {
  return value
    .trim()
    .replace(/^smb:\/\//i, '')
    .replace(/^\\+/, '')
    .split(/[\\/]/, 1)[0]
    .trim()
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

export function isRemotePathMissing(error: unknown): boolean {
  const code = nasErrorCode(error)
  return code === 'STATUS_OBJECT_NAME_NOT_FOUND'
    || code === 'STATUS_OBJECT_PATH_NOT_FOUND'
    || code === 'STATUS_NO_SUCH_FILE'
}

export class SmbTransport implements NasTransport {
  private readonly client: SMB2Client
  private readonly config: NasSyncSettings
  private treePromise: Promise<SmbTree> | null = null

  constructor(config: NasSyncSettings) {
    this.config = config
    this.client = new SMB2Client(serverHost(config.server), {
      port: config.port,
      connectTimeout: 10_000,
      requestTimeout: 30_000,
    })
  }

  private async tree(): Promise<SmbTree> {
    if (!this.treePromise) {
      this.treePromise = (async () => {
        const session = await this.client.authenticate({
          domain: '',
          username: this.config.username,
          password: this.config.password,
          forceNtlmVersion: 'v2',
        })
        return session.connectTree(this.config.share.trim())
      })()
    }
    try {
      return await this.treePromise
    } catch (error) {
      this.treePromise = null
      throw error
    }
  }

  private async entries(remotePath: string): Promise<SmbDirectoryEntry[]> {
    return this.tree().then(async (tree) => (await tree.readDirectory(clientPath(remotePath))) as unknown as SmbDirectoryEntry[])
  }

  async listShares(): Promise<NasShare[]> {
    const client = new ShareDiscoveryClient({
      host: serverHost(this.config.server),
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      connectTimeout: 10_000,
      requestTimeout: 30_000,
    })
    try {
      await client.connect()
      const shares = await client.listShares()
      return shares
        .map((share) => ({
          name: share.name,
          type: toNasShareType(share.type),
          comment: share.comment ?? '',
        }))
        .filter((share) => share.name.length > 0)
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  async probe(): Promise<string[]> {
    const entries = await this.entries('')
    const directories = entries
      .filter((entry) => entry.type === 'Directory')
      .map((entry) => entryName(entry.filename))
      .filter((name) => name.length > 0)
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    return ['/', ...directories]
  }

  async listFiles(remotePath: string): Promise<NasRemoteFile[]> {
    const entries = await this.entries(remotePath)
    return entries
      .filter((entry) => entry.type === 'File')
      .map((entry) => ({
        name: entryName(entry.filename),
        size: Number(entry.fileSize ?? 0),
      }))
      .filter((entry) => entry.name.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async ensureDirectory(remotePath: string): Promise<void> {
    const parts = remotePathParts(remotePath)
    let current = ''
    const tree = await this.tree()
    for (const part of parts) {
      current = joinRemotePath(current, part)
      const existing = await this.stat(current)
      if (existing?.isDirectory) continue
      if (existing) throw new Error('NAS 目标路径不是目录')
      await tree.createDirectory(clientPath(current))
    }
  }

  async stat(remotePath: string): Promise<NasRemoteStat | null> {
    const parts = remotePathParts(remotePath)
    if (parts.length === 0) {
      await this.entries('')
      return { size: 0, isDirectory: true }
    }
    const name = parts.pop()
    const parentPath = parts.join('/')
    const entry = (await this.entries(parentPath)).find((candidate) => entryName(candidate.filename) === name)
    if (!entry) return null
    return { size: Number(entry.fileSize ?? 0), isDirectory: entry.type === 'Directory' }
  }

  async copyFile(
    sourcePath: string,
    remotePath: string,
    onProgress: (bytes: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const source = createReadStream(sourcePath)
    let destination: { destroy(): void } | null = null
    let completed = false
    let copied = 0
    const onData = (chunk: Buffer): void => {
      copied += chunk.length
      onProgress(copied)
    }
    try {
      destination = await (await this.tree()).createFileWriteStream(clientPath(remotePath)) as unknown as { destroy(): void }
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
    await (await this.tree()).renameFile(clientPath(sourcePath), clientPath(targetPath))
  }

  async remove(remotePath: string): Promise<void> {
    try {
      await (await this.tree()).removeFile(clientPath(remotePath))
    } catch (error) {
      if (!isRemotePathMissing(error)) throw error
    }
  }

  close(): void {
    const socket = this.client.socket
    void this.client.close().catch(() => undefined)
    socket?.destroy()
  }
}

interface SmbDirectoryEntry {
  filename: string
  type: 'File' | 'Directory'
  fileSize: unknown
}

type SmbSession = Awaited<ReturnType<SMB2Client['authenticate']>>
type SmbTree = Awaited<ReturnType<SmbSession['connectTree']>>

function clientPath(remotePath: string): string {
  const parts = remotePathParts(remotePath)
  return parts.length > 0 ? `/${parts.join('/')}` : '/'
}

function entryName(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value
}

function toNasShareType(value: unknown): NasShareType {
  return value === 'disk' || value === 'ipc' || value === 'print' ? value : 'special'
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
