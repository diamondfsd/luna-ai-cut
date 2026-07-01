/**
 * 设备调试服务 — 独立日志文件 + 一键测试
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

import { GoUltraClient, AuthState } from './goUltraProtocol'
import { GO_ULTRA_DEVICE } from './deviceDefaults'
import { logMainInfo } from './loggerService'

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
  ensureDir(logDir())
  const filePath = logFilePath()
  logStream = fs.createWriteStream(filePath, { flags: 'a' })
  logStream.write(`[${timestamp()}] [INFO] [DeviceDebug] 日志文件已创建\n`)
  logMainInfo('[DeviceDebug] 日志文件', { path: filePath })
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
  ensureLogStream()
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
 * @param deviceId 设备 ID ('luna-ultra' | 'go-ultra')
 * @param host 相机 IP
 * @param onLog 实时日志回调
 */
export async function runDeviceTest(
  deviceId: string,
  host: string,
  onLog: (level: string, message: string, data?: unknown) => void,
): Promise<TestResult> {
  const isGoUltra = deviceId === 'go-ultra'
  const steps: TestStepResult[] = []
  let finalAuthState = 'none'

  function log(level: string, message: string, data?: unknown): void {
    writeDeviceDebugLog(level, message, data)
    onLog(level, message, data)
  }

  log('INFO', `========== 一键测试开始 ==========`)
  log('INFO', `设备: ${deviceId}, 主机: ${host}`)

  // ---- 步骤 1: 端口检测 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 1/5] 端口检测...')
    let httpOk = false
    let controlOk = false
    let detail = ''

    try {
      const httpResp = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(3000) })
      httpOk = true
      detail = `HTTP ${httpResp.status}`
      log('INFO', `  HTTP 端口: ✅ (${httpResp.status})`)
    } catch (error) {
      detail = `HTTP ❌ (${String(error)})`
      log('WARN', `  HTTP 端口: ❌ (${String(error)})`)
    }

    try {
      if (isGoUltra) {
        const client = new GoUltraClient(host, GO_ULTRA_DEVICE.controlPort)
        const status = await client.checkStatus()
        controlOk = status.controlOk
      } else {
        await fetch(`http://${host}:6666/`, { signal: AbortSignal.timeout(2000) })
        controlOk = true
      }
      if (controlOk) {
        detail += ` | 控制 ✅`
        log('INFO', `  控制端口: ✅`)
      }
    } catch {
      detail += ` | 控制 ❌`
      log('WARN', `  控制端口: ❌`)
    }

    const elapsed = performance.now() - t0
    steps.push({ step: '端口检测', success: httpOk && controlOk, detail, elapsedMs: Math.round(elapsed) })
  }

  // ---- 步骤 2: 连接 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 2/5] 连接设备...')
    try {
      if (isGoUltra) {
        const client = new GoUltraClient(host, GO_ULTRA_DEVICE.controlPort)
        await client.connect()
        finalAuthState = client.authState
        log('INFO', `  连接成功, 授权状态: ${client.authState}`)
      } else {
        await (await import('./lunaProtocol')).LunaClient.prototype.connect.call({
          host,
        })
        // 直接用 luna connect
        const resp = await fetch(`http://${host}/DCIM/`, { signal: AbortSignal.timeout(5000) })
        log('INFO', `  连接成功, HTTP: ${resp.status}`)
        finalAuthState = 'basic_auth_done'
      }

      const elapsed = performance.now() - t0
      steps.push({ step: '设备连接', success: true, detail: `连接成功, 状态: ${finalAuthState}`, elapsedMs: Math.round(elapsed) })
    } catch (error) {
      const elapsed = performance.now() - t0
      log('ERROR', `  连接失败: ${String(error)}`)
      steps.push({ step: '设备连接', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
    }
  }

  // ---- 步骤 3: 授权（仅 Go Ultra） ----
  if (isGoUltra) {
    const t0 = performance.now()
    log('INFO', '[步骤 3/5] 授权检查...')
    try {
      const client = new GoUltraClient(host, GO_ULTRA_DEVICE.controlPort)
      if (client.authState === AuthState.NEED_CAMERA_CONFIRM) {
        log('WARN', '  需要用户在 Go Ultra 相机上确认授权')
        log('INFO', '  等待授权中（最多 60 秒）...')

        // 等最多 60 秒，轮询检查 authState
        let waited = 0
        while (waited < 60) {
          await delay(1000)
          waited++
          if (String(client.authState) === 'authorized') break
          if (waited % 10 === 0) {
            log('INFO', `  ...已等待 ${waited} 秒，请在相机上确认`)
          }
        }

        if (String(client.authState) === 'authorized') {
          const elapsed = performance.now() - t0
          log('INFO', `  授权成功 ✅ (等待 ${waited} 秒)`)
          steps.push({ step: '授权确认', success: true, detail: `用户确认授权, 等待 ${waited} 秒`, elapsedMs: Math.round(elapsed) })
        } else {
          const elapsed = performance.now() - t0
          log('WARN', `  授权超时或失败`)
          steps.push({ step: '授权确认', success: false, detail: `授权超时或未确认`, elapsedMs: Math.round(elapsed) })
        }
      } else if (client.authState === AuthState.AUTHORIZED) {
        const elapsed = performance.now() - t0
        log('INFO', `  已授权 ✅`)
        steps.push({ step: '授权检查', success: true, detail: '已授权', elapsedMs: Math.round(elapsed) })
      } else {
        const elapsed = performance.now() - t0
        log('WARN', `  授权状态异常: ${client.authState}`)
        steps.push({ step: '授权检查', success: false, detail: `状态: ${client.authState}`, elapsedMs: Math.round(elapsed) })
      }
    } catch (error) {
      const elapsed = performance.now() - t0
      log('ERROR', `  授权检查异常: ${String(error)}`)
      steps.push({ step: '授权检查', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
    }
  } else {
    // Luna 不需要授权，直接算成功
    steps.push({ step: '授权检查', success: true, detail: 'Luna 设备无需授权', elapsedMs: 0 })
  }

  // ---- 步骤 4: HTTP 文件访问 ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 4/5] 文件列表读取...')
    try {
      const path = isGoUltra ? '/DCIM/' : '/storage_internal/DCIM/'
      const resp = await fetch(`http://${host}${path}`, { signal: AbortSignal.timeout(8000) })
      if (resp.ok) {
        const text = await resp.text()
        const fileCount = (text.match(/<a href/g) || []).length - 1 // 减去 ../

        const elapsed = performance.now() - t0
        log('INFO', `  HTTP ${resp.status}, 文件数: ${fileCount}`)
        steps.push({ step: '文件列表', success: true, detail: `HTTP ${resp.status}, ${fileCount} 个文件`, elapsedMs: Math.round(elapsed) })
      } else {
        const elapsed = performance.now() - t0
        log('WARN', `  HTTP ${resp.status}: ${resp.statusText}`)
        steps.push({ step: '文件列表', success: false, detail: `HTTP ${resp.status}`, elapsedMs: Math.round(elapsed) })
      }
    } catch (error) {
      const elapsed = performance.now() - t0
      log('ERROR', `  文件列表异常: ${String(error)}`)
      steps.push({ step: '文件列表', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
    }
  }

  // ---- 步骤 5: BLE 唤醒探测（预留） ----
  {
    const t0 = performance.now()
    log('INFO', '[步骤 5/5] 连接保活测试...')
    try {
      if (isGoUltra) {
        const client = new GoUltraClient(host, GO_ULTRA_DEVICE.controlPort)
        client.startKeepAlive(5000)
        await delay(1000)
        client.stopKeepAlive()
      }
      const elapsed = performance.now() - t0
      log('INFO', `  保活测试完成`)
      steps.push({ step: '保活测试', success: true, detail: '保活启动正常', elapsedMs: Math.round(elapsed) })
    } catch (error) {
      const elapsed = performance.now() - t0
      log('WARN', `  保活异常: ${String(error)}`)
      steps.push({ step: '保活测试', success: false, detail: String(error), elapsedMs: Math.round(elapsed) })
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
    deviceId,
    host,
    overall,
    steps,
    authState: finalAuthState,
    summary,
  }
}
