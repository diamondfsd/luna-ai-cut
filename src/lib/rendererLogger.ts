/**
 * 渲染进程日志工具
 * 通过 IPC 将日志发送到主进程落盘
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 标记当前日志是否来自 logger 方法，避免 console 拦截重复发送 */
let _fromLogger = false

function sendLog(level: LogLevel, message: string, meta?: unknown): void {
  try {
    window.luna?.log(level, message, meta)
  } catch {
    // 如果 IPC 不可用（如开发环境无 electron），静默忽略
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
 * - 替换 console.log/warn/error 方法，让所有 console 输出也通过 IPC 发送到主进程
 * - 这样可以捕获第三方库的 console 输出
 */
export function initRendererLogger(): void {
  const originalLog = console.log.bind(console)
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)
  const originalInfo = console.info.bind(console)
  const originalDebug = console.debug.bind(console)

  console.log = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    originalLog(...args)
  }
  console.warn = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    originalWarn(...args)
  }
  console.error = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    originalError(...args)
  }
  console.info = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    originalInfo(...args)
  }
  console.debug = (...args: unknown[]) => {
    if (!_fromLogger) sendLog('debug', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    originalDebug(...args)
  }

  logger.info('渲染进程日志系统初始化完成')
}
