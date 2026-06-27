import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LOG_DIR = 'logs'
const MAIN_PREFIX = 'main'
const RENDERER_PREFIX = 'renderer'
const MAX_LOG_DAYS = 30

function logDir(): string {
  return path.join(app.getPath('userData'), LOG_DIR)
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function logFilePath(prefix: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(logDir(), `${prefix}-${dateStr}.log`)
}

/** 递归清理 meta 对象中的文件路径，只保留文件名，避免泄露用户目录 */
function sanitizePaths(value: unknown): unknown {
  if (typeof value === 'string') {
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

/** 清理超过 30 天的日志文件 */
function cleanOldLogs(): void {
  try {
    const dir = logDir()
    const files = fs.readdirSync(dir)
    const now = Date.now()
    for (const file of files) {
      if (!file.endsWith('.log')) continue
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
      if (ageDays > MAX_LOG_DAYS) {
        fs.rmSync(filePath)
        console.log(`[logger] 已清理过期日志: ${file}`)
      }
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
      if (!file.endsWith('.log')) continue
      fs.rmSync(path.join(dir, file))
      count++
    }
    logMainInfo(`已清空 ${count} 个日志文件`)
  } catch {
    // 目录可能还不存在
  }
}

/** 初始化日志系统 */
export function initLogger(): void {
  ensureDir(logDir())
  cleanOldLogs()
  logMainInfo('日志系统初始化完成')
}
