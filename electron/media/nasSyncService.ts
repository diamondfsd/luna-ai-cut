import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { DEFAULT_NAS_DEBUG_CONFIG } from '../../src/shared/nasSyncDebugConfig'
import type { AppSettings, NasRemoteFile, NasSyncEnqueueResult, NasSyncItem, NasSyncProbeResult, NasSyncSettings, NasSyncStatus } from '../../src/shared/types'
import { getLocalResourcesDir, getSettings } from '../storage/fileService'
import { logMainError, logMainInfo, logMainWarn } from '../infrastructure/loggerService'
import {
  isRemotePathMissing,
  remoteFilePath,
  remoteRootPath,
  remoteTemporaryPath,
  nasErrorCode,
  nasErrorMessage,
  SmbTransport,
  type NasTransport,
} from './nasSyncTransport'

interface PersistedNasSyncState {
  version: 1
  items: NasSyncItem[]
  lastSyncedAt: string | null
  lastError: string | null
}

const MAX_ATTEMPTS = 3
const MAX_STATUS_FILES = 100
const NETWORK_RETRY_DELAY_MS = 5_000
const NETWORK_RETRY_WINDOW_MS = 30 * 60 * 1_000
const execFileAsync = promisify(execFile)

function now(): string {
  return new Date().toISOString()
}

function errorCode(error: unknown): string {
  return nasErrorCode(error)
}

function rawErrorMessage(error: unknown): string {
  return nasErrorMessage(error)
}

function userFacingNasError(error: unknown): string {
  const code = errorCode(error)
  const message = rawErrorMessage(error).toLowerCase()
  if (code.includes('LOGON') || code.includes('AUTH') || code.includes('PASSWORD')) return '账号或密码错误'
  if (code.includes('ACCESS_DENIED') || code.includes('WRITE_PROTECT')) return '没有 NAS 写入权限'
  if (code.includes('DISK_FULL') || code.includes('QUOTA')) return 'NAS 存储空间不足'
  if (code === 'STATUS_BAD_NETWORK_NAME') return 'NAS 共享目录不存在'
  if (code.includes('OBJECT_NAME_NOT_FOUND') || code.includes('OBJECT_PATH_NOT_FOUND')) return 'NAS 目标路径不存在'
  if (code.includes('BAD_NETWORK') || code.includes('NETWORK') || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'NAS 暂时不可达'
  if (message.includes('the share is not valid')) return 'NAS 共享配置无效'
  if (message.includes('enoent') || message.includes('no such file')) return '本地文件已不存在'
  return `NAS 同步失败：${rawErrorMessage(error)}`
}

function isRetryableNasError(error: unknown): boolean {
  const code = errorCode(error)
  const message = rawErrorMessage(error).toLowerCase()
  if (isRemotePathMissing(error)
    || code.includes('ACCESS_DENIED')
    || code.includes('LOGON')
    || code.includes('AUTH')
    || code.includes('DISK_FULL')
    || code.includes('QUOTA')
    || message.includes('本地文件已不存在')) return false
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNREFUSED', 'ENETDOWN', 'EAI_AGAIN', 'STATUS_NETWORK_NAME_DELETED', 'STATUS_CONNECTION_DISCONNECTED'].includes(code)
    || message.includes('socket hang up')
    || message.includes('timeout')
    || message.includes('network')
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('NAS 同步已取消'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    const cancel = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(new Error('NAS 同步已取消'))
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

function abortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'NAS 同步已取消')
}

function isConnectionConfigured(config: NasSyncSettings | undefined): config is NasSyncSettings {
  return Boolean(
    config
    && typeof config.server === 'string'
    && typeof config.share === 'string'
    && typeof config.remotePath === 'string'
    && typeof config.username === 'string'
    && typeof config.password === 'string'
    && config.server.trim(),
  )
}

function validNasPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535
}

function isConfigured(config: NasSyncSettings | undefined): config is NasSyncSettings {
  return isConnectionConfigured(config) && validNasPort(config.port) && config.remotePath.trim().length > 0
}

function sourceCreatedAt(item: NasSyncItem): number {
  return item.sourceCreatedAtMs ?? item.sourceMtimeMs ?? 0
}

function syncPriority(left: NasSyncItem, right: NasSyncItem): number {
  return sourceCreatedAt(left) - sourceCreatedAt(right) || left.queuedAt.localeCompare(right.queuedAt)
}

function taskItemWindow(items: NasSyncItem[]): Pick<NasSyncStatus, 'taskItems' | 'taskItemsTruncated'> {
  const tasks = items
    .filter((item) => item.state === 'queued' || item.state === 'syncing' || item.state === 'failed' || item.state === 'canceled')
    .sort(syncPriority)
  return {
    taskItems: tasks.slice(0, MAX_STATUS_FILES).map((item) => ({
      id: item.id,
      fileName: item.fileName,
      targetPath: item.targetPath,
      bytes: item.bytes,
      downloadedBytes: item.downloadedBytes,
      sourceCreatedAtMs: item.sourceCreatedAtMs,
      state: item.state,
      error: item.error,
    })),
    taskItemsTruncated: tasks.length > MAX_STATUS_FILES,
  }
}

function commandLineArgument(command: string, name: string): string | null {
  const match = command.match(new RegExp(`--${name}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(\\S+))`))
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function isLoopbackNasHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^smb:\/\//, '').replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function nasHost(value: string): string {
  return value.trim().replace(/^smb:\/\//i, '').replace(/^\\+/, '').split(/[\\/]/, 1)[0].trim()
}

async function hostReachable(host: string): Promise<boolean> {
  const args = process.platform === 'win32'
    ? ['-n', '1', '-w', '1000', host]
    : process.platform === 'darwin'
      ? ['-c', '1', '-W', '1000', host]
      : ['-c', '1', '-W', '1', host]
  try {
    await execFileAsync('ping', args, { timeout: 2_000 })
    return true
  } catch {
    return false
  }
}

function isMissingLocalPath(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}

function statePathFor(settings: AppSettings): string {
  return path.join(settings.baseDir, 'nas-sync', 'state.json')
}

function insideRoot(root: string, sourcePath: string): boolean {
  const relative = path.relative(root, sourcePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function relativePathFor(roots: string[], sourcePath: string): string | null {
  const root = [...roots].sort((a, b) => b.length - a.length).find((candidate) => insideRoot(candidate, sourcePath))
  if (!root) return null
  const relative = path.relative(root, sourcePath)
  const parts = relative.split(path.sep)
  if (parts.some((part) => part === '..' || part === '.')) return null
  return parts.join('/')
}

function normalizeItem(value: Partial<NasSyncItem>): NasSyncItem | null {
  if (typeof value.id !== 'string' || typeof value.sourcePath !== 'string' || typeof value.targetPath !== 'string') return null
  const state: NasSyncItem['state'] = value.state === 'synced' || value.state === 'failed' || value.state === 'canceled' || value.state === 'syncing'
    ? value.state
    : 'queued'
  const sourceMtimeMs = typeof value.sourceMtimeMs === 'number' && Number.isFinite(value.sourceMtimeMs) ? value.sourceMtimeMs : null
  const sourceCreatedAtMs = typeof value.sourceCreatedAtMs === 'number' && Number.isFinite(value.sourceCreatedAtMs)
    ? value.sourceCreatedAtMs
    : sourceMtimeMs
  return {
    id: value.id,
    sourcePath: value.sourcePath,
    targetPath: value.targetPath,
    fileName: typeof value.fileName === 'string' ? value.fileName : path.basename(value.sourcePath),
    bytes: typeof value.bytes === 'number' && Number.isFinite(value.bytes) ? value.bytes : null,
    sourceSize: typeof value.sourceSize === 'number' && Number.isFinite(value.sourceSize) ? value.sourceSize : null,
    sourceMtimeMs,
    sourceCreatedAtMs,
    state: state === 'syncing' ? 'queued' : state,
    attempts: typeof value.attempts === 'number' && Number.isFinite(value.attempts) ? value.attempts : 0,
    downloadedBytes: 0,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    queuedAt: typeof value.queuedAt === 'string' ? value.queuedAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now(),
  }
}

export class NasSyncService {
  private state: PersistedNasSyncState = { version: 1, items: [], lastSyncedAt: null, lastError: null }
  private loadedPath: string | null = null
  private loadPromise: Promise<void> | null = null
  private persistChain: Promise<void> = Promise.resolve()
  private workerPromise: Promise<void> | null = null
  private currentController: AbortController | null = null
  private currentItemId: string | null = null
  private currentSpeedBps = 0
  private lastProgressAt = 0
  private lastProgressBytes = 0
  private lastProgressEmitAt = 0
  private pauseRequested = false
  private cancelRequested = false
  private offline = false
  private networkRetryTimer: ReturnType<typeof setTimeout> | null = null
  private networkRetryUntil = 0
  private onProgress: ((status: NasSyncStatus) => void) | null = null
  private debugConfig: NasSyncSettings | null = null

  setProgressListener(listener: ((status: NasSyncStatus) => void) | null): void {
    this.onProgress = listener
  }

  getEffectiveSettings(settings: AppSettings): AppSettings {
    if (!this.debugConfig) return settings
    return { ...settings, nasSync: { ...this.debugConfig } }
  }

  isDebugMode(): boolean {
    return this.debugConfig !== null
  }

  async setDebugMode(enabled: boolean): Promise<NasSyncSettings> {
    this.debugConfig = enabled ? { ...DEFAULT_NAS_DEBUG_CONFIG } : null
    const settings = await getSettings()
    await this.handleSettingsChanged(settings)
    return this.getEffectiveSettings(settings).nasSync ?? { ...DEFAULT_NAS_DEBUG_CONFIG, enabled: false, autoSync: false }
  }

  async getDebugLocalRoot(): Promise<string | null> {
    if (!this.debugConfig || process.platform === 'win32' || !isLoopbackNasHost(this.debugConfig.server)) return null
    try {
      const configuredRoot = process.env.LUNA_NAS_DEBUG_ROOT
      if (configuredRoot && path.isAbsolute(configuredRoot)) {
        const stats = await fs.stat(configuredRoot).catch(() => null)
        if (stats?.isDirectory()) return path.resolve(configuredRoot)
      }

      const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'command='])
      for (const command of stdout.split('\n')) {
        if (!command.includes('luna-ai-cut-smb-demo') && !command.includes('go run .')) continue
        const listen = commandLineArgument(command, 'listen')
        if (!listen?.endsWith(`:${this.debugConfig.port}`)) continue
        const share = commandLineArgument(command, 'share')
        if (share && share.toLowerCase() !== this.debugConfig.share.toLowerCase()) continue
        const root = commandLineArgument(command, 'root')
        if (!root || !path.isAbsolute(root)) continue
        const stats = await fs.stat(root).catch(() => null)
        if (stats?.isDirectory()) return path.resolve(root)
      }
      return null
    } catch {
      return null
    }
  }

  async initialize(): Promise<void> {
    const settings = this.getEffectiveSettings(await getSettings())
    await this.ensureLoaded(settings)
    this.emit(settings)
    this.startWorkerIfNeeded()
  }

  async handleSettingsChanged(settings: AppSettings): Promise<void> {
    const effectiveSettings = this.getEffectiveSettings(settings)
    await this.ensureLoaded(effectiveSettings)
    if (!effectiveSettings.nasSync?.enabled) {
      this.pauseRequested = true
      this.offline = false
      this.networkRetryUntil = 0
      this.clearNetworkRetry()
      this.currentController?.abort()
      this.emit(effectiveSettings)
      return
    }
    // Keep the pause marker until an in-flight copy has observed the abort. This
    // prevents a quick disable/enable sequence from turning a paused item into a failure.
    if (!this.currentController) this.pauseRequested = false
    this.networkRetryUntil = 0
    this.clearNetworkRetry()
    this.emit(effectiveSettings)
    this.startWorkerIfNeeded()
  }

  async getStatus(): Promise<NasSyncStatus> {
    const settings = this.getEffectiveSettings(await getSettings())
    await this.ensureLoaded(settings)
    return this.statusFor(settings)
  }

  async probe(configOverride?: NasSyncSettings): Promise<NasSyncProbeResult> {
    const settings = this.getEffectiveSettings(await getSettings())
    const config = configOverride ?? settings.nasSync
    if (!isConnectionConfigured(config)) return { ok: false, message: '请先填写服务器地址' }
    if (!validNasPort(config.port)) return { ok: false, message: 'NAS 端口必须是 1 到 65535 的整数' }
    let transport: NasTransport | null = null
    try {
      transport = new SmbTransport(config)
      const shares = await transport.listShares()
      if (!config.share.trim()) return { ok: true, shares }
      const directories = await transport.probe(config.remotePath)
      return { ok: true, shares, directories }
    } catch (error) {
      logMainWarn('[NAS] 连接检测失败', { error: rawErrorMessage(error) })
      return { ok: false, message: userFacingNasError(error) }
    } finally {
      transport?.close()
    }
  }

  async listFiles(): Promise<NasRemoteFile[]> {
    const settings = this.getEffectiveSettings(await getSettings())
    const config = settings.nasSync
    if (!isConfigured(config)) throw new Error('请先完成 NAS 配置')
    let transport: NasTransport | null = null
    try {
      transport = new SmbTransport(config)
      return await transport.listFiles(remoteRootPath(config))
    } finally {
      transport?.close()
    }
  }

  async enqueueFiles(filePaths: string[]): Promise<NasSyncEnqueueResult> {
    const settings = this.getEffectiveSettings(await getSettings())
    if (!settings.nasSync?.enabled) throw new Error('请先开启 NAS 同步')
    if (!isConfigured(settings.nasSync)) throw new Error('请先填写服务器地址')
    await this.ensureLoaded(settings)

    const roots = [getLocalResourcesDir(settings), ...(settings.downloadDirectories ?? [])]
      .filter((root) => path.isAbsolute(root))
      .map((root) => path.resolve(root))
    const result: NasSyncEnqueueResult = { queued: 0, skipped: 0 }
    let changed = false
    for (const value of filePaths) {
      if (typeof value !== 'string' || !path.isAbsolute(value)) {
        result.skipped += 1
        continue
      }
      const sourcePath = path.resolve(value)
      let stats
      try {
        stats = await fs.stat(sourcePath)
      } catch {
        result.skipped += 1
        continue
      }
      if (!stats.isFile()) {
        result.skipped += 1
        continue
      }
      const relativePath = relativePathFor(roots, sourcePath)
      if (!relativePath) {
        result.skipped += 1
        continue
      }
      const existing = this.state.items.find((item) => item.sourcePath === sourcePath && item.targetPath === relativePath)
      if (existing && existing.state === 'synced' && existing.sourceSize === stats.size && existing.sourceMtimeMs === stats.mtimeMs) {
        result.skipped += 1
        continue
      }
      if (existing && (existing.state === 'queued' || existing.state === 'syncing')) {
        result.skipped += 1
        continue
      }
      const sourceCreatedAtMs = Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
        ? stats.birthtimeMs
        : stats.mtimeMs
      const item: NasSyncItem = existing ?? {
        id: randomUUID(),
        sourcePath,
        targetPath: relativePath,
        fileName: path.basename(sourcePath),
        bytes: stats.size,
        sourceSize: stats.size,
        sourceMtimeMs: stats.mtimeMs,
        sourceCreatedAtMs,
        state: 'queued',
        attempts: 0,
        downloadedBytes: 0,
        queuedAt: now(),
        updatedAt: now(),
      }
      Object.assign(item, {
        sourcePath,
        targetPath: relativePath,
        fileName: path.basename(sourcePath),
        bytes: stats.size,
        sourceSize: stats.size,
        sourceMtimeMs: stats.mtimeMs,
        sourceCreatedAtMs,
        state: 'queued',
        attempts: 0,
        downloadedBytes: 0,
        error: undefined,
        updatedAt: now(),
      })
      if (!existing) this.state.items.push(item)
      result.queued += 1
      changed = true
    }
    if (changed) {
      this.state.lastError = null
      this.networkRetryUntil = 0
      await this.persist(settings)
      this.emit(settings)
      this.startWorkerIfNeeded()
    }
    return result
  }

  async syncLocalResources(): Promise<NasSyncEnqueueResult> {
    const settings = this.getEffectiveSettings(await getSettings())
    if (!settings.nasSync?.enabled) throw new Error('请先开启 NAS 同步')
    if (!isConfigured(settings.nasSync)) throw new Error('请先填写服务器地址')

    const root = path.resolve(getLocalResourcesDir(settings))
    const filePaths: string[] = []

    async function walk(directory: string): Promise<void> {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) await walk(entryPath)
        else if (entry.isFile()) filePaths.push(entryPath)
      }
    }

    try {
      await walk(root)
    } catch (error) {
      if (isMissingLocalPath(error)) return { queued: 0, skipped: 0 }
      logMainWarn('[NAS] 本地资源目录读取失败', { root, error: rawErrorMessage(error) })
      throw new Error('本地资源目录读取失败')
    }

    return this.enqueueFiles(filePaths)
  }

  async retryFailed(): Promise<number> {
    const settings = this.getEffectiveSettings(await getSettings())
    if (!settings.nasSync?.enabled) throw new Error('请先开启 NAS 同步')
    if (!isConfigured(settings.nasSync)) throw new Error('请先填写服务器地址')
    await this.ensureLoaded(settings)
    let count = 0
    for (const item of this.state.items) {
      if (item.state !== 'failed' && item.state !== 'canceled') continue
      item.state = 'queued'
      item.downloadedBytes = 0
      item.error = undefined
      item.updatedAt = now()
      count += 1
    }
    if (count > 0) {
      this.state.lastError = null
      await this.persist(settings)
      this.emit(settings)
      this.startWorkerIfNeeded()
    }
    return count
  }

  async cancelPending(): Promise<void> {
    const settings = this.getEffectiveSettings(await getSettings())
    await this.ensureLoaded(settings)
    this.cancelRequested = true
    for (const item of this.state.items) {
      if (item.state !== 'queued') continue
      item.state = 'canceled'
      item.downloadedBytes = 0
      item.updatedAt = now()
    }
    this.currentController?.abort()
    if (!this.state.items.some((item) => item.state === 'queued')) {
      this.offline = false
      this.networkRetryUntil = 0
      this.clearNetworkRetry()
    }
    await this.persist(settings)
    this.emit(settings)
  }

  async clearFinished(): Promise<number> {
    const settings = this.getEffectiveSettings(await getSettings())
    await this.ensureLoaded(settings)
    const before = this.state.items.length
    this.state.items = this.state.items.filter((item) => item.state !== 'synced' && item.state !== 'canceled')
    const removed = before - this.state.items.length
    if (removed > 0) {
      await this.persist(settings)
      this.emit(settings)
    }
    return removed
  }

  private async ensureLoaded(settings: AppSettings): Promise<void> {
    const targetPath = statePathFor(settings)
    if (this.loadedPath === targetPath) return this.loadPromise ?? Promise.resolve()
    if (this.loadPromise) await this.loadPromise
    if (this.loadedPath === targetPath) return
    this.loadPromise = (async () => {
      let stored: Partial<PersistedNasSyncState> = {}
      try {
        stored = JSON.parse(await fs.readFile(targetPath, 'utf8')) as Partial<PersistedNasSyncState>
      } catch {
        // 首次使用或旧版本没有同步记录时从空队列开始。
      }
      this.state = {
        version: 1,
        items: Array.isArray(stored.items)
          ? stored.items.map((item) => normalizeItem(item)).filter((item): item is NasSyncItem => Boolean(item))
          : [],
        lastSyncedAt: typeof stored.lastSyncedAt === 'string' ? stored.lastSyncedAt : null,
        lastError: typeof stored.lastError === 'string' ? stored.lastError : null,
      }
      this.loadedPath = targetPath
    })()
    try {
      await this.loadPromise
    } finally {
      this.loadPromise = null
    }
  }

  private persist(settings: AppSettings): Promise<void> {
    const targetPath = statePathFor(settings)
    const operation = this.persistChain.then(async () => {
      const temporaryPath = `${targetPath}.${process.pid}.tmp`
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.writeFile(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8')
      try {
        await fs.rename(temporaryPath, targetPath)
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
        throw error
      }
    })
    this.persistChain = operation.catch(() => undefined)
    return operation
  }

  private emit(settings: AppSettings): void {
    this.onProgress?.(this.statusFor(settings))
  }

  private statusFor(settings: AppSettings): NasSyncStatus {
    const items = this.state.items
    const activeItems = items.filter((item) => item.state !== 'canceled')
    const completedItems = activeItems.filter((item) => item.state === 'synced')
    const pendingItems = activeItems.filter((item) => item.state === 'queued' || item.state === 'syncing')
    const failedItems = activeItems.filter((item) => item.state === 'failed')
    const current = this.currentItemId ? items.find((item) => item.id === this.currentItemId) : undefined
    const itemWindow = taskItemWindow(items)
    const totalBytes = activeItems.every((item) => item.bytes !== null)
      ? activeItems.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
      : null
    const completedBytes = completedItems.reduce((sum, item) => sum + (item.sourceSize ?? item.bytes ?? 0), 0)
    const downloadedBytes = completedBytes + (current?.downloadedBytes ?? 0)
    const config = settings.nasSync
    let state: NasSyncStatus['state'] = 'ready'
    if (!config?.enabled) state = 'disabled'
    else if (!isConfigured(config)) state = 'not-configured'
    else if (current) state = 'syncing'
    else if (this.offline && pendingItems.length > 0) state = 'offline'
    else if (failedItems.length > 0) state = 'error'
    return {
      state,
      totalFiles: activeItems.length,
      completedFiles: completedItems.length,
      pendingFiles: pendingItems.length,
      failedFiles: failedItems.length,
      canceledFiles: items.filter((item) => item.state === 'canceled').length,
      totalBytes,
      completedBytes,
      currentFileName: current?.fileName ?? null,
      currentDownloadedBytes: current?.downloadedBytes ?? 0,
      currentTotalBytes: current?.bytes ?? null,
      speedBps: this.currentSpeedBps,
      percent: totalBytes !== null && totalBytes > 0
        ? Math.min(100, (downloadedBytes / totalBytes) * 100)
        : activeItems.length > 0 ? (completedItems.length / activeItems.length) * 100 : 100,
      remotePath: config ? [config.share, config.remotePath].filter(Boolean).join('/') || null : null,
      lastSyncedAt: this.state.lastSyncedAt,
      lastError: this.state.lastError,
      updatedAt: now(),
      failedItems: failedItems.slice(-10).map((item) => ({ id: item.id, fileName: item.fileName, error: item.error ?? '同步失败' })),
      ...itemWindow,
    }
  }

  private startWorkerIfNeeded(): void {
    if (this.workerPromise) return
    this.workerPromise = this.runWorker().catch((error) => {
      logMainError('[NAS] 同步队列异常', { error: rawErrorMessage(error) })
    }).finally(() => {
      this.workerPromise = null
    })
  }

  private clearNetworkRetry(): void {
    if (!this.networkRetryTimer) return
    clearTimeout(this.networkRetryTimer)
    this.networkRetryTimer = null
  }

  private scheduleNetworkRetry(): void {
    if (this.networkRetryTimer) return
    if (Date.now() >= this.networkRetryUntil) return
    this.networkRetryTimer = setTimeout(() => {
      this.networkRetryTimer = null
      this.startWorkerIfNeeded()
    }, NETWORK_RETRY_DELAY_MS)
  }

  private async nasAvailable(config: NasSyncSettings): Promise<boolean> {
    if (!await hostReachable(nasHost(config.server))) return false
    let transport: NasTransport | null = null
    try {
      transport = new SmbTransport(config)
      await transport.probe(config.remotePath)
      return true
    } catch (error) {
      // Authentication, permission, and directory problems should still be
      // reported by the queued upload. Only connection failures wait for retry.
      return !isRetryableNasError(error)
    } finally {
      transport?.close()
    }
  }

  private async runWorker(): Promise<void> {
    let running = true
    while (running) {
      const settings = this.getEffectiveSettings(await getSettings())
      await this.ensureLoaded(settings)
      if (!settings.nasSync?.enabled || !isConfigured(settings.nasSync)) {
        this.emit(settings)
        running = false
        return
      }
      const item = this.state.items
        .filter((candidate) => candidate.state === 'queued')
        .sort(syncPriority)[0]
      if (!item) {
        this.offline = false
        this.networkRetryUntil = 0
        this.clearNetworkRetry()
        this.emit(settings)
        running = false
        return
      }
      if (!await this.nasAvailable(settings.nasSync)) {
        if (this.networkRetryUntil === 0) this.networkRetryUntil = Date.now() + NETWORK_RETRY_WINDOW_MS
        this.offline = true
        this.emit(settings)
        this.scheduleNetworkRetry()
        running = false
        return
      }
      this.offline = false
      this.networkRetryUntil = 0
      this.clearNetworkRetry()
      this.pauseRequested = false
      this.cancelRequested = false
      this.currentItemId = item.id
      this.currentController = new AbortController()
      this.currentSpeedBps = 0
      this.lastProgressAt = Date.now()
      this.lastProgressBytes = 0
      this.lastProgressEmitAt = 0
      item.state = 'syncing'
      item.attempts += 1
      item.downloadedBytes = 0
      item.error = undefined
      item.updatedAt = now()
      await this.persist(settings)
      this.emit(settings)
      let retryWhenNetworkReturns = false
      try {
        await this.syncItem(item, settings, this.currentController.signal)
        item.state = 'synced'
        item.downloadedBytes = item.sourceSize ?? item.bytes ?? 0
        item.error = undefined
        item.updatedAt = now()
        this.state.lastSyncedAt = now()
        this.state.lastError = null
        logMainInfo('[NAS] 文件同步成功', { fileName: item.fileName, targetPath: item.targetPath })
      } catch (error) {
        const latestSettings = await getSettings().then((next) => this.getEffectiveSettings(next)).catch(() => settings)
        if (abortError(error) && (this.pauseRequested || !latestSettings.nasSync?.enabled)) {
          item.state = 'queued'
          item.downloadedBytes = 0
          item.error = undefined
        } else if (abortError(error) && this.cancelRequested) {
          item.state = 'canceled'
          item.downloadedBytes = 0
          item.error = undefined
        } else if (isRetryableNasError(error)) {
          item.state = 'queued'
          item.downloadedBytes = 0
          item.error = undefined
          if (this.networkRetryUntil === 0) this.networkRetryUntil = Date.now() + NETWORK_RETRY_WINDOW_MS
          this.offline = true
          this.scheduleNetworkRetry()
          retryWhenNetworkReturns = true
        } else {
          item.state = 'failed'
          item.downloadedBytes = 0
          item.error = userFacingNasError(error)
          this.state.lastError = item.error
          logMainWarn('[NAS] 文件同步失败', { fileName: item.fileName, error: rawErrorMessage(error) })
        }
        item.updatedAt = now()
      } finally {
        this.currentController = null
        this.currentItemId = null
        this.currentSpeedBps = 0
        this.lastProgressAt = 0
        this.lastProgressBytes = 0
        await this.persist(settings)
        this.emit(await getSettings().then((next) => this.getEffectiveSettings(next)).catch(() => settings))
      }
      if (retryWhenNetworkReturns) {
        running = false
        return
      }
    }
  }

  private async syncItem(item: NasSyncItem, settings: AppSettings, signal: AbortSignal): Promise<void> {
    const config = settings.nasSync
    if (!isConfigured(config)) throw new Error('请先填写服务器地址')
    let localStats
    try {
      localStats = await fs.stat(item.sourcePath)
    } catch {
      throw new Error('本地文件已不存在')
    }
    if (!localStats.isFile()) throw new Error('本地文件已不存在')
    if (item.sourceSize !== null && localStats.size !== item.sourceSize) throw new Error('本地文件已发生变化，请重新同步')
    const targetPath = remoteFilePath(config, item.targetPath)
    const rootPath = remoteRootPath(config)
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error('NAS 同步已取消')
      let transport: NasTransport | null = null
      const temporaryPath = remoteTemporaryPath(targetPath, item.id)
      try {
        transport = new SmbTransport(config)
        await transport.ensureDirectory(rootPath)
        await transport.ensureDirectory(remoteFilePath(config, pathPartsForTarget(item.targetPath)))
        const existing = await transport.stat(targetPath)
        if (existing && !existing.isDirectory && existing.size === localStats.size) return
        if (existing) throw new Error('目标已有不同内容')
        await transport.copyFile(item.sourcePath, temporaryPath, (bytes) => {
          const timestamp = Date.now()
          const elapsedMs = timestamp - this.lastProgressAt
          if (elapsedMs > 0) this.currentSpeedBps = Math.max(0, ((bytes - this.lastProgressBytes) * 1000) / elapsedMs)
          this.lastProgressAt = timestamp
          this.lastProgressBytes = bytes
          item.downloadedBytes = bytes
          if (timestamp - this.lastProgressEmitAt >= 80) {
            this.lastProgressEmitAt = timestamp
            this.emit(settings)
          }
        }, signal)
        const temporaryStats = await transport.stat(temporaryPath)
        if (!temporaryStats || temporaryStats.size !== localStats.size) throw new Error('NAS 文件校验失败')
        await transport.rename(temporaryPath, targetPath)
        return
      } catch (error) {
        lastError = error
        if (transport) await transport.remove(temporaryPath).catch(() => undefined)
        if (abortError(error) || signal.aborted) throw new Error('NAS 同步已取消')
        if (!isRetryableNasError(error) || attempt >= MAX_ATTEMPTS) throw error
        await delay(700 * attempt, signal)
      } finally {
        transport?.close()
      }
    }
    throw lastError ?? new Error('NAS 同步失败')
  }
}

function pathPartsForTarget(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

export const nasSyncService = new NasSyncService()
