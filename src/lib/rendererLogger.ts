/**
 * 渲染进程日志工具
 * 通过 IPC 将日志发送到主进程落盘
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

import { serializeDiagnosticValue } from '../shared/crashDiagnosticUtils'

/** 标记当前日志是否来自 logger 方法，避免 console 拦截重复发送 */
let _fromLogger = false
let _initialized = false

function sendLog(level: LogLevel, message: string, meta?: unknown): void {
  try {
    window.luna?.log(level, message, meta)
  } catch {
    // 如果 IPC 不可用（如开发环境无 electron），静默忽略
  }
}

function formatConsoleArgument(value: unknown): string {
  try {
    const serialized = serializeDiagnosticValue(value)
    if (serialized === undefined) return 'undefined'
    if (typeof serialized === 'string') return serialized
    return JSON.stringify(serialized) ?? String(serialized)
  } catch {
    try { return String(value) } catch { return '[无法记录的日志参数]' }
  }
}

/** 导出相关日志 */
export function logExport(message: string, meta?: unknown): void {
  try {
    window.luna?.logExport(message, meta)
  } catch {
    // silent
  }
  // 同时也写本地 console
  _fromLogger = true
  console.log(`[EXPORT] ${message}`, meta !== undefined ? meta : '')
  _fromLogger = false
}

// 日志级别方法
export const logger = {
  debug: (message: string, meta?: unknown) => {
    _fromLogger = true
    sendLog('debug', message, meta)
    console.debug(`[DEBUG] ${message}`, meta !== undefined ? meta : '')
    _fromLogger = false
  },
  info: (message: string, meta?: unknown) => {
    _fromLogger = true
    sendLog('info', message, meta)
    console.info(`[INFO] ${message}`, meta !== undefined ? meta : '')
    _fromLogger = false
  },
  warn: (message: string, meta?: unknown) => {
    _fromLogger = true
    sendLog('warn', message, meta)
    console.warn(`[WARN] ${message}`, meta !== undefined ? meta : '')
    _fromLogger = false
  },
  error: (message: string, meta?: unknown) => {
    _fromLogger = true
    sendLog('error', message, meta)
    console.error(`[ERROR] ${message}`, meta !== undefined ? meta : '')
    _fromLogger = false
  },
}

/**
 * 初始化渲染进程日志系统
 * - 仅转存 console.warn/error，避免组件调试输出淹没诊断信息
 * - 显式 logger 调用仍按调用方指定的级别落盘
 */
export function initRendererLogger(): void {
  if (_initialized) return
  _initialized = true

  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  console.warn = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('warn', args.map(formatConsoleArgument).join(' '))
    originalWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('error', args.map(formatConsoleArgument).join(' '))
    originalError(...args)
  }

  window.addEventListener('error', (event) => {
    sendLog('error', '[诊断] 渲染进程全局异常', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: serializeDiagnosticValue(event.error),
    })
  }, true)
  window.addEventListener('unhandledrejection', (event) => {
    sendLog('error', '[诊断] 渲染进程未处理的异步异常', {
      reason: serializeDiagnosticValue(event.reason),
    })
  })

  const logRoute = () => {
    sendLog('info', '[诊断] 当前页面', { route: window.location.hash || '#/library' })
  }
  window.addEventListener('hashchange', logRoute)

  logger.info('渲染进程日志系统初始化完成')
  logRoute()
}
