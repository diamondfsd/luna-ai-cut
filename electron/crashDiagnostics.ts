import { app, crashReporter, type BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  isCrashDumpFile,
  isUncleanRunMarker,
  selectCrashDumpFilesToPrune,
  serializeDiagnosticValue,
  type RunMarker,
} from '../src/shared/crashDiagnosticUtils'
import { getLogDir, logMainError, logMainInfo, logMainWarn } from './loggerService'

const RUN_MARKER_FILE = '.diagnostic-run.json'
let installed = false
let currentRunStartedAt = ''
let dumpSyncTimer: ReturnType<typeof setTimeout> | null = null

interface CrashDumpEntry {
  path: string
  relativePath: string
  mtimeMs: number
}

function markerPath(): string {
  return path.join(app.getPath('userData'), RUN_MARKER_FILE)
}

function readMarker(): unknown {
  try {
    return JSON.parse(fs.readFileSync(markerPath(), 'utf8'))
  } catch {
    return null
  }
}

function writeMarker(marker: RunMarker): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 2), 'utf8')
  } catch (error) {
    logMainError('[诊断] 无法写入运行状态', serializeDiagnosticValue(error))
  }
}

function findCrashDumps(dir: string, relativeDir = ''): CrashDumpEntry[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) return findCrashDumps(entryPath, relativePath)
    if (!entry.isFile() || !isCrashDumpFile(relativePath)) return []
    try {
      return [{ path: entryPath, relativePath, mtimeMs: fs.statSync(entryPath).mtimeMs }]
    } catch {
      return []
    }
  })
}

function copyRecentCrashDumps(): void {
  const crashDumpsDir = app.getPath('crashDumps')
  const targetDir = path.join(getLogDir(), 'crash-dumps')
  const dumps = findCrashDumps(crashDumpsDir)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 10)
  if (dumps.length === 0) return

  fs.mkdirSync(targetDir, { recursive: true })
  let copied = 0
  for (const dump of dumps) {
    const parent = path.basename(path.dirname(dump.relativePath))
    const destination = path.join(targetDir, `${parent}-${path.basename(dump.relativePath)}`)
    try {
      const existing = fs.existsSync(destination) ? fs.statSync(destination) : null
      const source = fs.statSync(dump.path)
      if (existing?.size === source.size) continue
      fs.copyFileSync(dump.path, destination)
      copied += 1
    } catch (error) {
      logMainWarn('[诊断] 崩溃文件复制失败', {
        fileName: path.basename(dump.path),
        error: serializeDiagnosticValue(error),
      })
    }
  }
  const targetDumps = findCrashDumps(targetDir).map((dump) => ({
    name: dump.relativePath,
    mtimeMs: dump.mtimeMs,
  }))
  for (const relativePath of selectCrashDumpFilesToPrune(targetDumps, 10)) {
    try {
      fs.rmSync(path.join(targetDir, relativePath))
    } catch (error) {
      logMainWarn('[诊断] 旧崩溃文件清理失败', {
        fileName: path.basename(relativePath),
        error: serializeDiagnosticValue(error),
      })
    }
  }
  logMainInfo('[诊断] 崩溃文件已同步到日志目录', { found: dumps.length, copied })
}

function scheduleCrashDumpSync(): void {
  if (dumpSyncTimer) clearTimeout(dumpSyncTimer)
  dumpSyncTimer = setTimeout(() => {
    dumpSyncTimer = null
    copyRecentCrashDumps()
  }, 1500)
  dumpSyncTimer.unref()
}

function startCrashReporter(): void {
  try {
    crashReporter.start({
      productName: 'Luna AI Cut',
      uploadToServer: false,
      ignoreSystemCrashHandler: false,
      globalExtra: {
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
      },
    })
    logMainInfo('[诊断] Crashpad 已启动', {
      crashDumpsDir: app.getPath('crashDumps'),
      startedAfterReady: app.isReady(),
    })
    copyRecentCrashDumps()
  } catch (error) {
    logMainError('[诊断] Crashpad 启动失败', serializeDiagnosticValue(error))
  }
}

export function installCrashDiagnostics(): void {
  if (installed) return
  installed = true

  const previousMarker = readMarker()
  if (isUncleanRunMarker(previousMarker)) {
    logMainWarn('[诊断] 上一次运行可能异常结束', previousMarker)
  }

  currentRunStartedAt = new Date().toISOString()
  writeMarker({
    status: 'running',
    pid: process.pid,
    startedAt: currentRunStartedAt,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  })
  startCrashReporter()

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logMainError('[诊断] 主进程未捕获异常', { origin, error: serializeDiagnosticValue(error) })
  })
  process.on('warning', (warning) => {
    logMainWarn('[诊断] Node 运行警告', serializeDiagnosticValue(warning))
  })

  app.on('child-process-gone', (_event, details) => {
    const log = details.reason === 'clean-exit' ? logMainInfo : logMainError
    log('[诊断] Electron 子进程退出', details)
    if (details.reason !== 'clean-exit') scheduleCrashDumpSync()
  })
  app.once('will-quit', () => {
    writeMarker({
      status: 'clean',
      pid: process.pid,
      startedAt: currentRunStartedAt,
      finishedAt: new Date().toISOString(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    })
    logMainInfo('[诊断] 应用正常退出')
  })
}

export function attachWindowCrashDiagnostics(win: BrowserWindow): void {
  win.on('unresponsive', () => {
    logMainError('[诊断] 应用界面无响应', { url: win.webContents.getURL() })
  })
  win.on('responsive', () => {
    logMainInfo('[诊断] 应用界面恢复响应', { url: win.webContents.getURL() })
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logMainError('[诊断] 渲染进程退出', { ...details, url: win.webContents.getURL() })
    scheduleCrashDumpSync()
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    logMainError('[诊断] 页面初始化脚本异常', {
      preloadPath,
      error: serializeDiagnosticValue(error),
    })
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logMainError('[诊断] 页面加载失败', { errorCode, errorDescription, validatedURL, isMainFrame })
  })
  win.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    let route = url
    try {
      route = new URL(url).hash || new URL(url).pathname
    } catch {
      // 保留原始地址，便于诊断格式异常的导航。
    }
    logMainInfo('[诊断] 页面内导航', { route, isMainFrame })
  })
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return
    const log = level === 3 ? logMainError : logMainWarn
    log('[诊断] 浏览器控制台消息', { level, message, line, sourceId })
  })
}
