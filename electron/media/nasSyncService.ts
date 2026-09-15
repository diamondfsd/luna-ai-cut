import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

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
  if (code.includes('OBJECT_NAME_NOT_FOUND') || code.includes('OBJECT_PATH_NOT_FOUND') || code === 'STATUS_BAD_NETWORK_NAME') return 'NAS 共享目录不存在'
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

function isConfigured(config: NasSyncSettings | undefined): config is NasSyncSettings {
  return isConnectionConfigured(config) && config.remotePath.trim().length > 0
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
  return {
    id: value.id,
    sourcePath: value.sourcePath,
    targetPath: value.targetPath,
    fileName: typeof value.fileName === 'string' ? value.fileName : path.basename(value.sourcePath),
    bytes: typeof value.bytes === 'number' && Number.isFinite(value.bytes) ? value.bytes : null,
    sourceSize: typeof value.sourceSize === 'number' && Number.isFinite(value.sourceSize) ? value.sourceSize : null,
    sourceMtimeMs: typeof value.sourceMtimeMs === 'number' && Number.isFinite(value.sourceMtimeMs) ? value.sourceMtimeMs : null,
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
  private pauseRequested = false
  private cancelRequested = false
  private onProgress: ((status: NasSyncStatus) => void) | null = null

  setProgressListener(listener: ((status: NasSyncStatus) => void) | null): void {
    this.onProgress = listener
  }

  async initialize(): Promise<void> {
    const settings = await getSettings()
    await this.ensureLoaded(settings)
    this.emit(settings)
    this.startWorkerIfNeeded()
  }

  async handleSettingsChanged(settings: AppSettings): Promise<void> {
    await this.ensureLoaded(settings)
    if (!settings.nasSync?.enabled) {
      this.pauseRequested = true
      this.currentController?.abort()
      this.emit(settings)
      return
    }
    // Keep the pause marker until an in-flight copy has observed the abort. This
    // prevents a quick disable/enable sequence from turning a paused item into a failure.
    if (!this.currentController) this.pauseRequested = false
    this.emit(settings)
    this.startWorkerIfNeeded()
  }

  async getStatus(): Promise<NasSyncStatus> {
    const settings = await getSettings()
    await this.ensureLoaded(settings)
    return this.statusFor(settings)
  }

  async probe(configOverride?: NasSyncSettings): Promise<NasSyncProbeResult> {
    const settings = await getSettings()
    const config = configOverride ?? settings.nasSync
    if (!isConnectionConfigured(config)) return { ok: false, message: '请先填写服务器地址' }
    let transport: NasTransport | null = null
    try {
      transport = new SmbTransport(config)
      const shares = await transport.listShares()
      if (!config.share.trim()) return { ok: true, shares }
      const directories = await transport.probe()
      return { ok: true, shares, directories }
    } catch (error) {
      logMainWarn('[NAS] 连接检测失败', { error: rawErrorMessage(error) })
      return { ok: false, message: userFacingNasError(error) }
    } finally {
      transport?.close()
    }
  }

  async listFiles(): Promise<NasRemoteFile[]> {
    const settings = await getSettings()
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
    const settings = await getSettings()
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
      const item: NasSyncItem = existing ?? {
        id: randomUUID(),
        sourcePath,
        targetPath: relativePath,
        fileName: path.basename(sourcePath),
        bytes: stats.size,
        sourceSize: stats.size,
        sourceMtimeMs: stats.mtimeMs,
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
      await this.persist(settings)
      this.emit(settings)
      this.startWorkerIfNeeded()
    }
    return result
  }

  async retryFailed(): Promise<number> {
    const settings = await getSettings()
    if (!settings.nasSync?.enabled) throw new Error('请先开启 NAS 同步')
    if (!isConfigured(settings.nasSync)) throw new Error('请先填写服务器地址')
    await this.ensureLoaded(settings)
    let count = 0
    for (const item of this.state.items) {
      if (item.state !== 'failed') continue
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
    const settings = await getSettings()
    await this.ensureLoaded(settings)
    this.cancelRequested = true
    for (const item of this.state.items) {
      if (item.state !== 'queued') continue
      item.state = 'canceled'
      item.downloadedBytes = 0
      item.updatedAt = now()
    }
    this.currentController?.abort()
    await this.persist(settings)
    this.emit(settings)
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

  private async runWorker(): Promise<void> {
    let running = true
    while (running) {
      const settings = await getSettings()
      await this.ensureLoaded(settings)
      if (!settings.nasSync?.enabled || !isConfigured(settings.nasSync)) {
        this.emit(settings)
        running = false
        return
      }
      const item = this.state.items.find((candidate) => candidate.state === 'queued')
      if (!item) {
        this.emit(settings)
        running = false
        return
      }
      this.pauseRequested = false
      this.cancelRequested = false
      this.currentItemId = item.id
      this.currentController = new AbortController()
      this.currentSpeedBps = 0
      this.lastProgressAt = Date.now()
      this.lastProgressBytes = 0
      item.state = 'syncing'
      item.attempts += 1
      item.downloadedBytes = 0
      item.error = undefined
      item.updatedAt = now()
      await this.persist(settings)
      this.emit(settings)
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
        const latestSettings = await getSettings().catch(() => settings)
        if (abortError(error) && (this.pauseRequested || !latestSettings.nasSync?.enabled)) {
          item.state = 'queued'
          item.downloadedBytes = 0
          item.error = undefined
        } else if (abortError(error) && this.cancelRequested) {
          item.state = 'canceled'
          item.downloadedBytes = 0
          item.error = undefined
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
        this.emit(await getSettings().catch(() => settings))
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
        const existing = await transport.stat(targetPath)
        if (existing && !existing.isDirectory && existing.size === localStats.size) return
        if (existing) throw new Error('目标已有不同内容')
        await transport.ensureDirectory(remoteFilePath(config, pathPartsForTarget(item.targetPath)))
        await transport.copyFile(item.sourcePath, temporaryPath, (bytes) => {
          const timestamp = Date.now()
          const elapsedMs = timestamp - this.lastProgressAt
          if (elapsedMs > 0) this.currentSpeedBps = Math.max(0, ((bytes - this.lastProgressBytes) * 1000) / elapsedMs)
          this.lastProgressAt = timestamp
          this.lastProgressBytes = bytes
          item.downloadedBytes = bytes
          this.emit(settings)
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
