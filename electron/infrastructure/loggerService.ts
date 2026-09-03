import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import AdmZip from 'adm-zip'
import { currentBaseDir, logDirForBaseDir } from '../storage/settingsService'
import { releaseChannelForVersion } from '../../src/shared/hotUpdateCompatibility'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const MAIN_PREFIX = 'main'
const RENDERER_PREFIX = 'renderer'

function logDir(): string {
  return logDirForBaseDir(currentBaseDir())
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function localDateKey(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function logFilePath(prefix: string, date: Date = new Date()): string {
  const dateStr = localDateKey(date)
  const version = app.getVersion()
  return path.join(logDir(), `${prefix}-${dateStr}-${version}.log`)
}

/** 递归清理 meta 对象中的文件路径，只保留文件名，避免泄露用户目录 */
function sanitizePaths(value: unknown): unknown {
  if (typeof value === 'string') {
    // 跳过 HTTP URL 和相机设备路径，保留完整信息方便调试
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/DCIM') || value.startsWith('/storage_')) return value
    // 将绝对路径替换为纯文件名：/Users/xxx/Pictures/file.mp4 → file.mp4
    return value.replace(/(?:\/[^\s/]+){2,}/g, (match) => {
      const idx = match.lastIndexOf('/')
      return match.slice(idx + 1)
    })
  }
  if (Array.isArray(value)) {
    return value.map(sanitizePaths)
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizePaths(v)
    }
    return result
  }
  return value
}

/** 获取本地时间字符串，格式：2026-06-27 17:30:00.123 +08:00 */
function localTimestamp(): string {
  const d = new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const h = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  const ms = pad(d.getMilliseconds(), 3)
  const off = -d.getTimezoneOffset()
  const offSign = off >= 0 ? '+' : '-'
  const offH = pad(Math.floor(Math.abs(off) / 60))
  const offM = pad(Math.abs(off) % 60)
  return `${y}-${mo}-${dd} ${h}:${mi}:${s}.${ms} ${offSign}${offH}:${offM}`
}

function formatLog(level: LogLevel, message: string, meta?: unknown): string {
  const safeMsg = sanitizePaths(message)
  const metaStr = meta !== undefined ? ` ${JSON.stringify(sanitizePaths(meta))}` : ''
  return `[${localTimestamp()}] [${level}] ${safeMsg}${metaStr}\n`
}

/** 每次启动只保留当天日志，避免历史调试输出干扰问题定位。 */
function cleanOldLogs(): void {
  try {
    const dir = logDir()
    const files = fs.readdirSync(dir)
    const today = localDateKey()
    for (const file of files) {
      if (!file.endsWith('.log')) continue
      const fileDate = file.match(/\d{4}-\d{2}-\d{2}/)?.[0]
      if (fileDate && fileDate !== today) fs.rmSync(path.join(dir, file))
    }
  } catch {
    // 目录可能还不存在
  }
}

function writeLog(prefix: string, level: LogLevel, message: string, meta?: unknown): void {
  try {
    const dir = logDir()
    ensureDir(dir)
    const filePath = logFilePath(prefix)
    const line = formatLog(level, message, meta)
    fs.appendFileSync(filePath, line, 'utf-8')
  } catch (err) {
    console.error('[logger] 写入日志失败:', err)
  }
}

// ===== 主进程日志方法 =====
// 使用这些方法替换 exportService.ts 和 watermarkService.ts 中的 console.log/warn/error

export function logMainDebug(message: string, meta?: unknown): void {
  writeLog(MAIN_PREFIX, 'DEBUG', message, meta)
}
export function logMainInfo(message: string, meta?: unknown): void {
  writeLog(MAIN_PREFIX, 'INFO', message, meta)
}
export function logMainWarn(message: string, meta?: unknown): void {
  writeLog(MAIN_PREFIX, 'WARN', message, meta)
}
export function logMainError(message: string, meta?: unknown): void {
  writeLog(MAIN_PREFIX, 'ERROR', message, meta)
}

/** 渲染进程发来的日志由这个函数写入 renderer 日志文件 */
export function logRendererMessage(level: string, message: string, meta?: unknown): void {
  const lvl = (['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO') as LogLevel
  writeLog(RENDERER_PREFIX, lvl, message, meta)
}

/** 导出相关日志（同时写入 main 和 renderer 日志）双写 */
export function logExport(level: string, message: string, meta?: unknown): void {
  const lvl = (['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO') as LogLevel
  writeLog(MAIN_PREFIX, lvl, `[EXPORT] ${message}`, meta)
  writeLog(RENDERER_PREFIX, lvl, `[EXPORT] ${message}`, meta)
}

/** 获取日志目录路径 */
export function getLogDir(): string {
  return logDir()
}

/** 清空所有日志文件 */
export function clearLogs(): void {
  try {
    const dir = logDir()
    const files = fs.readdirSync(dir)
    let count = 0
    for (const file of files) {
      if (file.endsWith('.log')) {
        fs.rmSync(path.join(dir, file))
        count++
      } else if (file === 'crash-dumps') {
        fs.rmSync(path.join(dir, file), { recursive: true, force: true })
      }
    }
    logMainInfo(`已清空 ${count} 个日志文件`)
  } catch {
    // 目录可能还不存在
  }
}

function addFileIfPresent(zip: AdmZip, filePath: string, entryName: string): void {
  try {
    if (fs.statSync(filePath).isFile()) zip.addLocalFile(filePath, path.dirname(entryName), path.basename(entryName))
  } catch {
    // 日志文件可能在导出期间轮换或尚未创建，跳过即可。
  }
}

function addDirectoryIfPresent(zip: AdmZip, directory: string, entryName: string): void {
  try {
    if (fs.statSync(directory).isDirectory()) zip.addLocalFolder(directory, entryName)
  } catch {
    // 没有崩溃转储目录时仍可导出其他诊断信息。
  }
}

/** 导出当前运行实例的诊断信息，供用户反馈问题时附带。 */
export function exportDiagnosticsBundle(): string {
  const directory = logDir()
  ensureDir(directory)
  const today = localDateKey()
  const zip = new AdmZip()
  const includedFiles: string[] = []

  try {
    for (const file of fs.readdirSync(directory)) {
      if (!file.endsWith('.log') || !file.includes(today)) continue
      const fullPath = path.join(directory, file)
      addFileIfPresent(zip, fullPath, `logs/${file}`)
      includedFiles.push(file)
    }
  } catch {
    // 目录读取失败时仍然生成带有环境信息的诊断包。
  }

  for (const file of ['startup.log', 'luna-rc.log']) {
    const fullPath = path.join(directory, file)
    addFileIfPresent(zip, fullPath, `logs/${file}`)
    try {
      if (fs.statSync(fullPath).isFile()) includedFiles.push(file)
    } catch {
      // optional log
    }
  }

  const crashDirectory = path.join(directory, 'crash-dumps')
  addDirectoryIfPresent(zip, crashDirectory, 'crash-dumps')

  const appVersion = app.getVersion()
  const channel = releaseChannelForVersion(appVersion)?.channel ?? 'unknown'
  const diagnostics = {
    exportedAt: new Date().toISOString(),
    appVersion,
    channel,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    bootSource: process.env.LUNA_BOOT_SOURCE ?? 'unknown',
    logDate: today,
    logDirectory: path.basename(directory),
    includedFiles: [...new Set(includedFiles)],
    hasCrashDumps: fs.existsSync(crashDirectory),
  }
  zip.addFile('diagnostics.json', Buffer.from(JSON.stringify(diagnostics, null, 2), 'utf8'))

  const exportDirectory = app.getPath('downloads')
  ensureDir(exportDirectory)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputPath = path.join(exportDirectory, `LunaAI-Cut-diagnostics-${stamp}.zip`)
  zip.writeZip(outputPath)
  logMainInfo('[诊断] 诊断包已导出', { outputPath: path.basename(outputPath), includedFiles: diagnostics.includedFiles })
  return outputPath
}

/** 初始化日志系统 */
export function initLogger(): void {
  ensureDir(logDir())
  cleanOldLogs()
  logMainInfo('日志系统初始化完成')
}
