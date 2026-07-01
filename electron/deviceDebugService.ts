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

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
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

  // ---- 步骤 1: 端口检测 — 通过协议适配器统一执行 ----
  let portResult: import('./deviceDebugProtocol').DebugPortResult
  {
    const t0 = performance.now()
    log('INFO', '[步骤 1/5] 端口检测...')
    portResult = await protocol.checkPort(host)
    const portDetail = `HTTP:${portResult.httpOk ? portResult.httpPort : '❌'} 控制:${portResult.controlOk ? portResult.controlPort : '❌'}`

    if (portResult.httpOk) log('INFO', `  HTTP 端口: ✅ (${portResult.httpPort})`)
    else log('WARN', `  HTTP 端口: ❌`)
    if (portResult.controlOk) log('INFO', `  控制端口: ✅ (${portResult.controlPort})`)
    else log('WARN', `  控制端口: ❌`)

    const elapsed = performance.now() - t0
    steps.push({ step: '端口检测', success: portResult.httpOk && portResult.controlOk, detail: portDetail, elapsedMs: Math.round(elapsed) })
  }

  // 端口全关 → 设备不在线，无需后续步骤
  if (!portResult.httpOk && !portResult.controlOk) {
    log('WARN', '  HTTP 和控制端口均无响应，跳过后续步骤')
    const summary = '❌ 设备未在线（端口全关）'
    log('INFO', `========== 测试结束: ${summary} ==========`)
    return { deviceId: protocol.deviceId, host, overall: false, steps, authState: 'none', summary }
  }

  // ---- 步骤 2: 连接 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 2/5] 连接设备...')
    try {
      await protocol.disconnect() // 确保之前状态已清理
      const connResult = await protocol.connect(host)
      finalAuthState = connResult.authState

      if (connResult.success) {
        log('INFO', `  连接成功, 授权状态: ${connResult.authState}`)
      } else {
        throw new Error(connResult.message)
      }

      const elapsed = performance.now() - t0
      steps.push({ step: '设备连接', success: true, detail: `连接成功, 状态: ${finalAuthState}`, elapsedMs: Math.round(elapsed) })
    } catch (error) {
      const elapsed = performance.now() - t0
      log('ERROR', `  连接失败: ${String(error)}`)
      steps.push({ step: '设备连接', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
    }
  }

  // ---- 步骤 3: 授权检查 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 3/5] 授权检查...')

    const authResult = await protocol.checkAuth()
    if (authResult.success) {
      // 已授权，直接成功
      const elapsed = performance.now() - t0
      log('INFO', `  ${authResult.message}`)
      steps.push({ step: '授权检查', success: true, detail: authResult.message, elapsedMs: Math.round(elapsed) })
    } else if (authResult.authState === 'need_camera_confirm') {
      // 需要用户在相机上确认，等待授权
      log('WARN', '  需要用户在相机上确认授权')
      log('INFO', '  发送授权请求...')
      await protocol.requestAuth()
      log('INFO', '  等待授权中（最多 60 秒）...')

      const authorized = await protocol.waitForAuthConfirm(60000)
      const elapsed = performance.now() - t0

      if (authorized) {
        finalAuthState = 'authorized'
        log('INFO', `  授权成功 ✅`)
        steps.push({ step: '授权确认', success: true, detail: '用户确认授权', elapsedMs: Math.round(elapsed) })
      } else {
        log('WARN', `  授权超时或失败`)
        steps.push({ step: '授权确认', success: false, detail: '授权超时或未确认', elapsedMs: Math.round(elapsed) })
      }
    } else if (authResult.authState === 'basic_auth_done') {
      // 不需要额外授权的设备（如 Luna Ultra），基础认证即完成
      const elapsed = performance.now() - t0
      log('INFO', `  ${authResult.message}`)
      steps.push({ step: '授权检查', success: true, detail: authResult.message, elapsedMs: Math.round(elapsed) })
    } else {
      // 未连接、授权失败、或异常状态
      const elapsed = performance.now() - t0
      log('WARN', `  授权检查失败: ${authResult.message}`)
      steps.push({ step: '授权检查', success: false, detail: authResult.message, elapsedMs: Math.round(elapsed) })
    }
  }

  // ---- 步骤 4: 文件列表 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 4/5] 读取文件列表...')

    try {
      const fileResult = await protocol.listFiles()
      const elapsed = performance.now() - t0

      if (fileResult.success && fileResult.files.length > 0) {
        log('INFO', `  找到 ${fileResult.files.length} 个文件`)
        steps.push({ step: '文件列表', success: true, detail: `找到 ${fileResult.files.length} 个文件`, elapsedMs: Math.round(elapsed) })
      } else if (fileResult.success) {
        log('WARN', `  文件列表为空`)
        steps.push({ step: '文件列表', success: true, detail: '文件列表为空（可能目录下无文件）', elapsedMs: Math.round(elapsed) })
      } else {
        log('WARN', `  读取文件列表失败: ${fileResult.message}`)
        steps.push({ step: '文件列表', success: false, detail: fileResult.message, elapsedMs: Math.round(elapsed) })
      }
    } catch (error) {
      const elapsed = performance.now() - t0
      log('WARN', `  文件列表异常: ${String(error)}`)
      steps.push({ step: '文件列表', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
    }
  }

  // ---- 步骤 5: 保活 / 连接确认 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 5/5] 保活 / 连接确认...')

    // 检查步骤 2 是否连接成功
    const step2 = steps.find((s) => s.step === '设备连接')
    const wasConnected = step2?.success === true

    if (!wasConnected) {
      const elapsed = performance.now() - t0
      log('WARN', `  设备未连接，跳过保活测试`)
      steps.push({ step: '保活测试', success: false, detail: '设备未连接，跳过', elapsedMs: Math.round(elapsed) })
    } else {
      try {
        log('INFO', '  启动保活定时器...')
        protocol.startKeepAlive(2000)
        // 等待至少一个保活周期，让保活定时器有机会执行
        await delay(2500)
        protocol.stopKeepAlive()

        // 主动做一次端口检测，验证设备仍在响应
        log('INFO', '  验证设备响应...')
        const healthCheck = await protocol.checkPort(host)

        const elapsed = performance.now() - t0
        if (healthCheck.httpOk && healthCheck.controlOk) {
          log('INFO', `  保活测试通过 ✅ (HTTP+控制通道均正常)`)
          steps.push({ step: '保活测试', success: true, detail: `保活正常, HTTP:${healthCheck.httpPort}, 控制:${healthCheck.controlPort}`, elapsedMs: Math.round(elapsed) })
        } else if (healthCheck.controlOk) {
          log('INFO', `  保活测试通过 ✅ (控制通道正常)`)
          steps.push({ step: '保活测试', success: true, detail: `保活正常, 控制通道活跃:${healthCheck.controlPort}`, elapsedMs: Math.round(elapsed) })
        } else {
          throw new Error(`保活后设备无响应: ${healthCheck.message}`)
        }
      } catch (error) {
        const elapsed = performance.now() - t0
        log('WARN', `  保活异常: ${String(error)}`)
        steps.push({ step: '保活测试', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
      }
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
