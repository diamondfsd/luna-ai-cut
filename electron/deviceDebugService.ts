/**
 * 设备调试服务 — 独立日志文件 + 一键测试
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

import { logMainInfo } from './loggerService'
import type { IDeviceDebugProtocol } from './deviceDebugProtocol'

// ============================================================
// 设备调试日志
// ============================================================

let logStream: fs.WriteStream | null = null

function logDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function logFilePath(): string {
  const date = new Date().toISOString().slice(0, 10)
  const version = app.getVersion()
  return path.join(logDir(), `device-debug-log-${date}-${version}.log`)
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const off = -d.getTimezoneOffset()
  const offSign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ${offSign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

function ensureLogStream(): void {
  if (logStream) return

  try {
    ensureDir(logDir())
    const filePath = logFilePath()

    // 健壮性：如果目标路径是目录（如之前 bug 遗留），先删掉再创建文件
    try {
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true })
        logMainInfo('[DeviceDebug] 清理了遗留的目录', { path: filePath })
      }
    } catch {
      // 文件不存在，正常
    }

    logStream = null

    logStream = fs.createWriteStream(filePath, { flags: 'a' })
    logStream.on('error', (err) => {
      console.error('[DeviceDebug] 日志流错误:', err)
    })
    logStream.write(`[${timestamp()}] [INFO] [DeviceDebug] 日志文件已创建\n`)
    logMainInfo('[DeviceDebug] 日志文件', { path: filePath })
  } catch (err) {
    console.error('[DeviceDebug] 创建日志流失败:', err)
    logStream = null
  }
}

/** 写入设备调试日志 */
export function writeDeviceDebugLog(level: string, message: string, data?: unknown): void {
  try {
    ensureLogStream()
    const metaStr = data !== undefined ? ` ${JSON.stringify(data)}` : ''
    const line = `[${timestamp()}] [${level}] [DeviceDebug] ${message}${metaStr}\n`
    logStream?.write(line)
  } catch (err) {
    console.error('[DeviceDebug] 写入日志失败:', err)
  }
}

/** 获取当前设备调试日志文件路径 */
export function getDeviceDebugLogPath(): string {
  try {
    ensureLogStream()
  } catch (err) {
    console.error('[DeviceDebug] 初始化日志流失败:', err)
  }
  return logFilePath()
}

/** 关闭日志流 */
export function closeDeviceDebugLog(): void {
  if (logStream) {
    logStream.end()
    logStream = null
  }
}

// ============================================================
// 一键测试
// ============================================================

export interface TestStepResult {
  step: string
  success: boolean
  detail: string
  elapsedMs: number
}

export interface TestResult {
  deviceId: string
  host: string
  overall: boolean
  steps: TestStepResult[]
  authState: string
  summary: string
}

/**
 * 运行完整连接测试
 *
 * 通过 IDeviceDebugProtocol 接口统一执行所有步骤，
 * 各设备类型的协议差异由适配器实现处理。
 *
 * @param protocol 设备调试协议适配器
 * @param host 相机 IP
 * @param onLog 实时日志回调
 */
export async function runDeviceTest(
  protocol: IDeviceDebugProtocol,
  host: string,
  onLog: (level: string, message: string, data?: unknown) => void,
): Promise<TestResult> {
  const steps: TestStepResult[] = []
  let finalAuthState = 'none'

  function log(level: string, message: string, data?: unknown): void {
    writeDeviceDebugLog(level, message, data)
    onLog(level, message, data)
  }

  log('INFO', `========== 一键测试开始 ==========`)
  log('INFO', `设备: ${protocol.deviceName} (${protocol.deviceId}), 主机: ${host}`)

  function pushStep(step: string, success: boolean, detail: string, startedAt: number): void {
    steps.push({ step, success, detail, elapsedMs: Math.round(performance.now() - startedAt) })
  }

  // ---- 步骤 1: 端口检测 ----
  let portResult: import('./deviceDebugProtocol').DebugPortResult
  {
    const t0 = performance.now()
    log('INFO', '[步骤 1/5] IP / 端口可达检测')
    portResult = await protocol.checkPort(host)
    const portDetail = `HTTP:${portResult.httpOk ? portResult.httpPort : '❌'} 控制:${portResult.controlOk ? portResult.controlPort : '❌'}`
    log(portResult.httpOk && portResult.controlOk ? 'INFO' : 'WARN', `  ${portDetail}`, portResult)
    pushStep('端口检测', portResult.httpOk && portResult.controlOk, portDetail, t0)
  }

  if (!portResult.httpOk && !portResult.controlOk) {
    log('WARN', '  HTTP 和控制端口均无响应，跳过后续步骤')
    const summary = '设备未在线（端口全关）'
    log('INFO', `========== 测试结束: ${summary} ==========`)
    return { deviceId: protocol.deviceId, host, overall: false, steps, authState: 'none', summary }
  }

  let diagnostics: Awaited<ReturnType<IDeviceDebugProtocol['runDiagnostics']>> | null = null

  // ---- 步骤 2: 获取设备信息 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 2/5] 获取设备信息（GET_OPTIONS）')
    try {
      diagnostics = await protocol.runDiagnostics(host, log)
      const info = diagnostics.deviceInfo
      const detail = info?.deviceName
        ? `${info.deviceName}${info.firmware ? ` / ${info.firmware}` : ''}${info.serial ? ` / ${info.serial}` : ''}`
        : '未解析到设备信息'
      log(info ? 'INFO' : 'WARN', `  ${detail}`, { deviceInfo: info, summary: diagnostics.summary })
      pushStep('设备信息', Boolean(info), detail, t0)
    } catch (error) {
      log('WARN', `  获取设备信息异常: ${String(error)}`)
      pushStep('设备信息', false, String(error), t0)
    }
  }

  // ---- 步骤 3: 授权 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 3/5] 授权检查 / 请求授权')
    try {
      let authResult = await protocol.checkAuth()
      finalAuthState = authResult.authState
      if (!authResult.success && authResult.authState === 'need_camera_confirm') {
        log('WARN', '  需要在相机上确认授权，发送授权请求')
        authResult = await protocol.requestAuth()
        finalAuthState = authResult.authState
        log('INFO', '  等待相机确认，最多 60 秒')
        if (await protocol.waitForAuthConfirm(60000)) {
          finalAuthState = 'authorized'
        }
      }
      const authorized = finalAuthState === 'authorized' || authResult.success || finalAuthState === 'basic_auth_done'
      if (authorized) {
        finalAuthState = 'authorized'
        log('INFO', `  授权通过: ${authResult.message}`, authResult)
        pushStep('授权', true, authResult.message, t0)
      } else {
        const detail = authResult.message || '授权未完成'
        log('WARN', `  ${detail}`, authResult)
        pushStep('授权', false, detail, t0)
      }
    } catch (error) {
      finalAuthState = 'failed'
      log('WARN', `  授权异常: ${String(error)}`)
      pushStep('授权', false, String(error), t0)
    }
  }

  let fileResult: Awaited<ReturnType<IDeviceDebugProtocol['listFiles']>> | null = null

  // ---- 步骤 4: TCP 文件列表 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 4/5] TCP 文件列表')
    try {
      fileResult = await protocol.listFiles()
      if (fileResult.success && fileResult.files.length > 0) {
        log('INFO', `  找到 ${fileResult.files.length} 个文件`, { sample: fileResult.files.slice(0, 5) })
        pushStep('TCP 文件列表', true, `找到 ${fileResult.files.length} 个文件`, t0)
      } else if (fileResult.success) {
        log('WARN', '  文件列表为空')
        pushStep('TCP 文件列表', true, '文件列表为空', t0)
      } else {
        log('WARN', `  ${fileResult.message}`)
        pushStep('TCP 文件列表', false, fileResult.message, t0)
      }
    } catch (error) {
      log('WARN', `  文件列表异常: ${String(error)}`)
      pushStep('TCP 文件列表', false, String(error), t0)
    }
  }

  // ---- 步骤 5: HTTP 可达验证 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 5/5] HTTP 文件 URL 可达验证')
    const http = fileResult?.http ?? diagnostics?.http ?? []
    const reachable = http.filter((item) => item.ok).length
    if (http.length === 0) {
      log('WARN', '  没有可验证的 HTTP 文件 URL')
      pushStep('HTTP 可达', false, '没有可验证的 HTTP 文件 URL', t0)
    } else {
      const detail = `${reachable}/${http.length} 可达`
      log(reachable > 0 ? 'INFO' : 'WARN', `  ${detail}`, http)
      pushStep('HTTP 可达', reachable > 0, detail, t0)
    }
  }

  // ---- 汇总 ----
  const successCount = steps.filter((s) => s.success).length
  const totalSteps = steps.length
  const overall = successCount === totalSteps
  const summary = overall
    ? `✅ 全部 ${totalSteps} 步测试通过`
    : `⚠️ ${successCount}/${totalSteps} 步通过`

  log('INFO', `========== 测试完成: ${summary} ==========`)

  return {
    deviceId: protocol.deviceId,
    host,
    overall,
    steps,
    authState: finalAuthState,
    summary,
  }
}
