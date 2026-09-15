import { execFile, spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  WifiDebugAddress,
  WifiConnectOptions,
  WifiDebugNetwork,
  WifiDebugResult,
  WifiDebugStatus,
  WifiHttpRequestOptions,
  WifiHttpRequestResult,
  WifiPortCheckOptions,
  WifiPortCheckResult,
} from '../../../src/shared/types'
import { getMacosHelperPath } from '../macos/swiftUtils'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

const execFileAsync = promisify(execFile)
const DEFAULT_WIFI_TIMEOUT_MS = 15000
const COREWLAN_HELPER_PATH = getMacosHelperPath('wifiCoreWlan')

function wifiStatusForLog(result: WifiDebugResult<WifiDebugStatus> | null | undefined): Record<string, unknown> {
  const data = result?.data
  return {
    success: result?.success ?? null,
    code: result?.code ?? null,
    message: result?.message ?? null,
    connected: data?.connected ?? null,
    ssid: data?.ssid ?? null,
    bssid: data?.bssid ?? null,
    interfaceName: data?.interfaceName ?? null,
    ipAddress: data?.ipAddress ?? null,
    ipAddresses: data?.ipAddresses?.map((item) => ({
      interfaceName: item.interfaceName,
      address: item.address,
      family: item.family,
    })) ?? [],
  }
}

async function runCommand(command: string, args: string[], timeoutMs = DEFAULT_WIFI_TIMEOUT_MS, signal?: AbortSignal): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: timeoutMs,
    signal,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4,
  })
  return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
}

function ok<T>(message: string, data: T, raw?: string): WifiDebugResult<T> {
  return { success: true, message, data, raw }
}

function fail<T>(message: string, code: string, raw?: string): WifiDebugResult<T> {
  return { success: false, message, code, raw }
}

function errorResult<T>(error: unknown, code = 'WIFI_DEBUG_ERROR'): WifiDebugResult<T> {
  if (error instanceof Error) return fail(error.message, code)
  return fail(String(error), code)
}

function unsupported<T>(): WifiDebugResult<T> {
  return fail(`当前平台暂不支持 Wi-Fi 调试：${process.platform}`, 'UNSUPPORTED_PLATFORM')
}

function firstWirelessIpv4(): string | null {
  const interfaces = os.networkInterfaces()
  const preferredNames = [/wi-?fi/i, /wlan/i, /airport/i, /en0/i]
  for (const matcher of preferredNames) {
    for (const [name, addresses] of Object.entries(interfaces)) {
      if (!matcher.test(name)) continue
      const match = addresses?.find((address) => address.family === 'IPv4' && !address.internal)
      if (match) return match.address
    }
  }
  for (const addresses of Object.values(interfaces)) {
    const match = addresses?.find((address) => address.family === 'IPv4' && !address.internal)
    if (match) return match.address
  }
  return null
}

function systemNetworkSnapshot(): Pick<WifiDebugStatus, 'interfaceName' | 'connected' | 'ipAddress' | 'ipAddresses' | 'interfaces' | 'raw'> {
  const rawInterfaces = os.networkInterfaces()
  const interfaces: Record<string, WifiDebugAddress[]> = {}
  const ipAddresses: WifiDebugAddress[] = []

  for (const [interfaceName, addresses] of Object.entries(rawInterfaces)) {
    const normalized = (addresses ?? []).map((address): WifiDebugAddress => ({
      interfaceName,
      address: address.address,
      family: address.family,
      netmask: address.netmask,
      mac: address.mac,
      cidr: address.cidr ?? null,
      internal: address.internal,
    }))
    if (normalized.length > 0) interfaces[interfaceName] = normalized
    ipAddresses.push(...normalized.filter((address) => !address.internal))
  }

  const primary =
    ipAddresses.find((address) => address.family === 'IPv4') ??
    ipAddresses[0] ??
    null

  return {
    interfaceName: primary?.interfaceName ?? null,
    connected: Boolean(primary),
    ipAddress: primary?.address ?? null,
    ipAddresses,
    interfaces,
    raw: JSON.stringify({ interfaces }, null, 2),
  }
}

function parseWindowsScan(raw: string): WifiDebugNetwork[] {
  const networks: WifiDebugNetwork[] = []
  let currentSsid = ''
  let security: string | null = null
  let bssid: string | null = null
  let signal: string | null = null
  let channel: string | null = null
  let rawBlock: string[] = []

  function flush(): void {
    if (!currentSsid) return
    networks.push({
      ssid: currentSsid,
      bssid,
      signal,
      security,
      channel,
      raw: rawBlock.join('\n'),
    })
  }

  for (const line of raw.split('\n')) {
    const ssidMatch = line.match(/^\s*SSID\s+\d+\s*:\s*(.*)$/i)
    if (ssidMatch) {
      flush()
      currentSsid = ssidMatch[1].trim()
      security = null
      bssid = null
      signal = null
      channel = null
      rawBlock = [line]
      continue
    }

    if (!currentSsid) continue
    rawBlock.push(line)
    security = line.match(/^\s*Authentication\s*:\s*(.+)$/i)?.[1]?.trim() ?? security
    const nextBssid = line.match(/^\s*BSSID\s+\d+\s*:\s*(.+)$/i)?.[1]?.trim()
    if (nextBssid && !bssid) bssid = nextBssid
    signal = line.match(/^\s*Signal\s*:\s*(.+)$/i)?.[1]?.trim() ?? signal
    channel = line.match(/^\s*Channel\s*:\s*(.+)$/i)?.[1]?.trim() ?? channel
  }
  flush()
  return networks.filter((network) => network.ssid)
}

function parseWindowsWifiStatus(raw: string, snapshot: ReturnType<typeof systemNetworkSnapshot>): WifiDebugStatus {
  const value = (labels: string[]): string | null => {
    const match = raw.match(new RegExp(`^\\s*(?:${labels.join('|')})\\s*:\\s*(.*)$`, 'im'))
    const result = match?.[1]?.trim()
    return result || null
  }

  const ssid = value(['SSID'])
  return {
    platform: 'win32',
    interfaceName: value(['Interface Name', 'Name', '接口名称']) ?? snapshot.interfaceName,
    connected: Boolean(ssid),
    ssid,
    bssid: value(['BSSID']),
    signal: value(['Signal', '信号']),
    security: value(['Authentication', '身份验证']),
    ipAddress: snapshot.ipAddress,
    ipAddresses: snapshot.ipAddresses,
    interfaces: snapshot.interfaces,
    raw,
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeWifiStatus(value: unknown, raw?: string): WifiDebugStatus {
  const data = jsonRecord(value)
  return {
    platform: typeof data.platform === 'string' ? data.platform : process.platform,
    interfaceName: typeof data.interfaceName === 'string' ? data.interfaceName : null,
    connected: Boolean(data.connected),
    ssid: typeof data.ssid === 'string' ? data.ssid : null,
    bssid: typeof data.bssid === 'string' ? data.bssid : null,
    signal: typeof data.signal === 'string' ? data.signal : null,
    security: typeof data.security === 'string' ? data.security : null,
    ipAddress: typeof data.ipAddress === 'string' ? data.ipAddress : null,
    raw,
  }
}

function normalizeWifiNetwork(value: unknown): WifiDebugNetwork {
  const data = jsonRecord(value)
  return {
    ssid: String(data.ssid ?? ''),
    bssid: typeof data.bssid === 'string' ? data.bssid : null,
    signal: typeof data.signal === 'string' ? data.signal : null,
    security: typeof data.security === 'string' ? data.security : null,
    channel: typeof data.channel === 'string' ? data.channel : null,
    raw: typeof data.raw === 'string' ? data.raw : JSON.stringify(data.raw ?? {}),
  }
}

function runCoreWlanCommand(args: string[], timeoutMs: number, stdin?: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const callId = `corewlan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    logMainInfo('[系统 Wi-Fi] macOS helper 开始执行', {
      callId,
      args,
      timeoutMs,
      passwordViaStdin: stdin !== undefined,
    })
    const child = spawn(COREWLAN_HELPER_PATH, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      logMainWarn('[系统 Wi-Fi] macOS helper 超时并终止', { callId, args, timeoutMs })
      child.kill('SIGKILL')
      finishReject(new Error(`CoreWLAN helper 超时（${timeoutMs}ms）`))
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', handleAbort)
    }
    const finishReject = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const handleAbort = (): void => {
      logMainWarn('[系统 Wi-Fi] macOS helper 被取消', { callId, args })
      child.kill('SIGKILL')
      finishReject(new Error('Wi-Fi 连接已取消'))
    }
    if (signal?.aborted) {
      handleAbort()
      return
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.stdin.on('error', () => undefined)
    child.once('error', (error) => {
      finishReject(error)
    })
    child.once('close', (code) => {
      if (settled) return
      const raw = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
      if (code !== 0 && !stdout) {
        logMainWarn('[系统 Wi-Fi] macOS helper 异常退出', {
          callId,
          args,
          exitCode: code,
          stdoutBytes: Buffer.byteLength(stdout),
          stderrBytes: Buffer.byteLength(stderr),
        })
        finishReject(new Error(raw || `CoreWLAN helper 退出码 ${code ?? '未知'}`))
        return
      }
      settled = true
      cleanup()
      logMainInfo('[系统 Wi-Fi] macOS helper 执行结束', {
        callId,
        args,
        exitCode: code,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
      })
      resolve(raw)
    })

    if (stdin !== undefined) {
      child.stdin.write(stdin, 'utf8')
    }
    child.stdin.end()
  })
}

async function runCoreWlan<T>(args: string[], timeoutMs = DEFAULT_WIFI_TIMEOUT_MS, stdin?: string, signal?: AbortSignal): Promise<WifiDebugResult<T>> {
  if (!existsSync(COREWLAN_HELPER_PATH)) {
    logMainWarn('[系统 Wi-Fi] 未找到 macOS helper', { args, timeoutMs })
    return fail('未找到 macOS Wi-Fi helper，请重新安装应用', 'COREWLAN_HELPER_NOT_FOUND')
  }

  const callId = `corewlan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  logMainInfo('[系统 Wi-Fi] macOS helper 请求', {
    callId,
    args,
    timeoutMs,
    passwordViaStdin: stdin !== undefined,
  })
  let raw: string
  try {
    raw = stdin === undefined
      ? await runCommand(COREWLAN_HELPER_PATH, args, timeoutMs, signal)
      : await runCoreWlanCommand(args, timeoutMs, stdin, signal)
  } catch (error) {
    logMainWarn('[系统 Wi-Fi] macOS helper 请求失败', {
      callId,
      args,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  logMainInfo('[系统 Wi-Fi] macOS helper 返回', { callId, args, rawBytes: Buffer.byteLength(raw) })
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    return fail('CoreWLAN helper 未返回 JSON', 'COREWLAN_INVALID_JSON', raw)
  }
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as WifiDebugResult<T>
  return { ...parsed, raw }
}

async function preferredDarwinWifiDevice(): Promise<string | null> {
  const raw = await runCommand('/usr/sbin/networksetup', ['-listallhardwareports'], 5000)
  const wifiBlock = raw
    .split(/\n\s*\n/)
    .find((block) => /^Hardware Port:\s*(Wi-Fi|AirPort)\s*$/im.test(block))
  return wifiBlock?.match(/^Device:\s*(\S+)\s*$/im)?.[1] ?? null
}

async function currentDarwinWifiSsid(interfaceName?: string | null): Promise<string | null> {
  const device = interfaceName || await preferredDarwinWifiDevice()
  if (!device) return null
  try {
    const raw = await runCommand('/usr/sbin/networksetup', ['-getairportnetwork', device], 5000)
    return raw.match(/Current Wi-Fi Network:\s*(.+)$/im)?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

/** Uses Apple's networksetup command as the primary macOS Wi-Fi join path. */
async function connectDarwinWifiWithNetworksetup(
  ssid: string,
  password: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WifiDebugResult<WifiDebugStatus>> {
  const device = await preferredDarwinWifiDevice()
  if (!device) return fail('未找到 macOS Wi-Fi 网卡', 'WIFI_INTERFACE_NOT_FOUND')

  const args = ['-setairportnetwork', device, ssid]
  if (password) args.push(password)
  const commandRaw = await runCommand('/usr/sbin/networksetup', args, timeoutMs, signal)
  const status = await getWifiDebugStatus().catch(() => null)
  const current = status?.data
  const raw = [commandRaw, status?.raw].filter(Boolean).join('\n')

  return ok(
    `networksetup 已尝试连接 ${ssid}`,
    {
      platform: 'darwin',
      interfaceName: current?.interfaceName ?? device,
      connected: current?.connected ?? true,
      ssid: current?.ssid ?? ssid,
      bssid: current?.bssid ?? null,
      signal: current?.signal ?? null,
      security: current?.security ?? null,
      ipAddress: current?.ipAddress ?? firstWirelessIpv4(),
      ipAddresses: current?.ipAddresses,
      interfaces: current?.interfaces,
      raw: current?.raw,
    },
    raw,
  )
}

/** A password supplied by the user is passed directly to CoreWLAN as fallback. */
async function connectDarwinWifiWithPassword(
  ssid: string,
  password: string,
  timeoutMs: number,
  bssid?: string,
  skipSsidVerification = false,
  signal?: AbortSignal,
): Promise<WifiDebugResult<WifiDebugStatus>> {
  const args = ['connect', '--ssid', ssid, '--password-stdin']
  if (skipSsidVerification) args.push('--skip-ssid-verification')
  if (bssid) args.push('--bssid', bssid)
  const result = await runCoreWlan<unknown>(args, Math.min(Math.max(timeoutMs, 10000), 30000), password, signal)
  if (!result.success) return result as WifiDebugResult<WifiDebugStatus>
  const status = normalizeWifiStatus(result.data, result.raw)
  return ok(
    result.message || `CoreWLAN 已连接 ${ssid}`,
    { ...status, ipAddress: status.ipAddress ?? firstWirelessIpv4() },
    result.raw,
  )
}

export async function getWifiDebugStatus(): Promise<WifiDebugResult<WifiDebugStatus>> {
  try {
    const snapshot = systemNetworkSnapshot()
    if (process.platform === 'win32') {
      const raw = await runCommand('netsh', ['wlan', 'show', 'interfaces'], 8000)
      const status = parseWindowsWifiStatus(raw, snapshot)
      return ok(status.connected ? 'Windows Wi-Fi 状态已刷新' : 'Windows 当前未连接 Wi-Fi', status, raw)
    }
    if (process.platform === 'darwin') {
      const result = await runCoreWlan<unknown>(['status'], 8000)
      if (result.success) {
        const status = normalizeWifiStatus(result.data, result.raw)
        const ssid = status.ssid ?? await currentDarwinWifiSsid(status.interfaceName ?? snapshot.interfaceName)
        return ok(result.message || 'CoreWLAN 状态已刷新', {
          ...status,
          interfaceName: status.interfaceName ?? snapshot.interfaceName,
          ssid,
          ipAddress: status.ipAddress ?? snapshot.ipAddress ?? firstWirelessIpv4(),
          ipAddresses: snapshot.ipAddresses,
          interfaces: snapshot.interfaces,
        }, result.raw)
      }
    }
    return ok('系统网卡信息已刷新', {
      platform: process.platform,
      ssid: process.platform === 'darwin' ? await currentDarwinWifiSsid(snapshot.interfaceName) : null,
      bssid: null,
      signal: null,
      security: null,
      ...snapshot,
    }, snapshot.raw)
  } catch (error) {
    return errorResult(error)
  }
}

export async function scanWifiNetworks(timeoutMs = 30000): Promise<WifiDebugResult<WifiDebugNetwork[]>> {
  try {
    if (process.platform === 'darwin') {
      const result = await runCoreWlan<unknown[]>(['scan'], timeoutMs)
      if (!result.success) return result as WifiDebugResult<WifiDebugNetwork[]>
      const networks = (result.data ?? []).map(normalizeWifiNetwork).filter((network) => network.ssid)
      return ok(result.message || `CoreWLAN 扫描到 ${networks.length} 个 Wi-Fi`, networks, result.raw)
    }

    if (process.platform === 'win32') {
      const raw = await runCommand('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 20000)
      const networks = parseWindowsScan(raw)
      return ok(`扫描到 ${networks.length} 个 Wi-Fi`, networks, raw)
    }

    return unsupported()
  } catch (error) {
    return errorResult(error, 'WIFI_SCAN_ERROR')
  }
}

function windowsWifiProfile(options: WifiConnectOptions): string {
  const authentication = options.password ? 'WPA2PSK' : 'open'
  const encryption = options.password ? 'AES' : 'none'
  const keyMaterial = options.password
    ? `<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${escapeXml(options.password)}</keyMaterial></sharedKey>`
    : ''

  return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${escapeXml(options.ssid)}</name>
  <SSIDConfig>
    <SSID><name>${escapeXml(options.ssid)}</name></SSID>
    <nonBroadcast>${options.hidden ? 'true' : 'false'}</nonBroadcast>
  </SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM>
    <security>
      <authEncryption>
        <authentication>${authentication}</authentication>
        <encryption>${encryption}</encryption>
        <useOneX>false</useOneX>
      </authEncryption>
      ${keyMaterial}
    </security>
  </MSM>
</WLANProfile>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function connectWifiNetwork(options: WifiConnectOptions, signal?: AbortSignal): Promise<WifiDebugResult<WifiDebugStatus>> {
  const ssid = options.ssid.trim()
  const timeoutMs = options.timeoutMs ?? DEFAULT_WIFI_TIMEOUT_MS
  const requestId = `wifi-connect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  if (!ssid) {
    const result = fail<WifiDebugStatus>('请输入 SSID', 'SSID_REQUIRED')
    logMainWarn('[系统 Wi-Fi] 连接请求缺少 SSID', { requestId })
    return result
  }

  logMainInfo('[系统 Wi-Fi] 连接请求开始', {
    requestId,
    platform: process.platform,
    ssid,
    bssid: options.bssid ?? null,
    timeoutMs,
    skipSsidVerification: options.skipSsidVerification === true,
    passwordProvided: Boolean(options.password),
  })

  try {
    if (process.platform === 'darwin') {
      if (options.preferNetworksetup && !options.bssid) {
        try {
          const result = await connectDarwinWifiWithNetworksetup(ssid, options.password, timeoutMs, signal)
          logMainInfo('[系统 Wi-Fi] 连接请求结束', { requestId, result: wifiStatusForLog(result) })
          return result
        } catch (networksetupError) {
          logMainWarn('[系统 Wi-Fi] networksetup 连接失败，回退 CoreWLAN', {
            requestId,
            ssid,
            error: networksetupError instanceof Error ? networksetupError.message : String(networksetupError),
          })
        }
      }

      if (options.password) {
        const result = await connectDarwinWifiWithPassword(ssid, options.password, timeoutMs, options.bssid, options.skipSsidVerification, signal)
        logMainInfo('[系统 Wi-Fi] 连接请求结束', { requestId, result: wifiStatusForLog(result) })
        return result
      }
      const args = ['connect', '--ssid', ssid]
      if (options.skipSsidVerification) args.push('--skip-ssid-verification')
      if (options.bssid) args.push('--bssid', options.bssid)
      const result = await runCoreWlan<unknown>(args, timeoutMs, undefined, signal)
      if (!result.success) {
        logMainInfo('[系统 Wi-Fi] 连接请求结束', { requestId, result: wifiStatusForLog(result as WifiDebugResult<WifiDebugStatus>) })
        return result as WifiDebugResult<WifiDebugStatus>
      }
      const status = normalizeWifiStatus(result.data, result.raw)
      const connectionResult = ok(result.message || `CoreWLAN 已尝试连接 ${ssid}`, { ...status, ipAddress: status.ipAddress ?? firstWirelessIpv4() }, result.raw)
      logMainInfo('[系统 Wi-Fi] 连接请求结束', { requestId, result: wifiStatusForLog(connectionResult) })
      return connectionResult
    }

    if (process.platform === 'win32') {
      const profilePath = path.join(os.tmpdir(), `luna-wifi-${Date.now()}.xml`)
      await fs.writeFile(profilePath, windowsWifiProfile({ ...options, ssid }), 'utf8')
      try {
        await runCommand('netsh', ['wlan', 'add', 'profile', `filename=${profilePath}`, 'user=current'], timeoutMs, signal)
        const raw = await runCommand('netsh', ['wlan', 'connect', `name=${ssid}`, `ssid=${ssid}`], timeoutMs, signal)
        const deadline = Date.now() + Math.min(Math.max(timeoutMs, 8000), 12000)
        let status = await getWifiDebugStatus()
        if (!options.skipSsidVerification) {
          while (status.success && status.data?.ssid !== ssid && Date.now() < deadline) {
            if (signal?.aborted) throw new Error('Wi-Fi 连接已取消')
            await new Promise((resolve) => setTimeout(resolve, 250))
            status = await getWifiDebugStatus()
          }
          if (status.success && status.data?.ssid !== ssid) {
            return {
              ...status,
              success: false,
              code: 'WIFI_SSID_NOT_MATCHED',
              message: `Windows 未切换到目标 Wi-Fi，当前网络为 ${status.data?.ssid ?? '未连接'}`,
              raw,
            }
          }
        }
        const connectionResult = {
          ...status,
          success: options.skipSsidVerification ? true : status.success,
          message: options.skipSsidVerification || status.success ? `已尝试连接 ${ssid}` : status.message,
          raw,
        }
        logMainInfo('[系统 Wi-Fi] 连接请求结束', { requestId, result: wifiStatusForLog(connectionResult) })
        return connectionResult
      } finally {
        await fs.unlink(profilePath).catch(() => undefined)
      }
    }

    const result = unsupported<WifiDebugStatus>()
    logMainInfo('[系统 Wi-Fi] 连接请求结束', { requestId, result: wifiStatusForLog(result) })
    return result
  } catch (error) {
    const result = errorResult<WifiDebugStatus>(error, 'WIFI_CONNECT_ERROR')
    logMainWarn('[系统 Wi-Fi] 连接请求异常结束', { requestId, result: wifiStatusForLog(result) })
    return result
  }
}

export async function disconnectWifiNetwork(): Promise<WifiDebugResult<WifiDebugStatus>> {
  const requestId = `wifi-disconnect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  logMainInfo('[系统 Wi-Fi] 断开请求开始', { requestId, platform: process.platform })
  try {
    if (process.platform === 'darwin') {
      const result = await runCoreWlan<unknown>(['disconnect'], 12000)
      if (!result.success) {
        logMainInfo('[系统 Wi-Fi] 断开请求结束', { requestId, result: wifiStatusForLog(result as WifiDebugResult<WifiDebugStatus>) })
        return result as WifiDebugResult<WifiDebugStatus>
      }
      const status = normalizeWifiStatus(result.data, result.raw)
      const disconnectResult = ok(result.message || 'CoreWLAN 已断开当前 Wi-Fi', { ...status, ipAddress: status.ipAddress ?? firstWirelessIpv4() }, result.raw)
      logMainInfo('[系统 Wi-Fi] 断开请求结束', { requestId, result: wifiStatusForLog(disconnectResult) })
      return disconnectResult
    }

    if (process.platform === 'win32') {
      const raw = await runCommand('netsh', ['wlan', 'disconnect'], 8000)
      const status = await getWifiDebugStatus()
      const disconnectResult = {
        ...status,
        message: status.success ? '已尝试断开当前 Wi-Fi' : status.message,
        raw,
      }
      logMainInfo('[系统 Wi-Fi] 断开请求结束', { requestId, result: wifiStatusForLog(disconnectResult) })
      return disconnectResult
    }

    const result = unsupported<WifiDebugStatus>()
    logMainInfo('[系统 Wi-Fi] 断开请求结束', { requestId, result: wifiStatusForLog(result) })
    return result
  } catch (error) {
    const result = errorResult<WifiDebugStatus>(error, 'WIFI_DISCONNECT_ERROR')
    logMainWarn('[系统 Wi-Fi] 断开请求异常结束', { requestId, result: wifiStatusForLog(result) })
    return result
  }
}

export async function checkWifiPort(options: WifiPortCheckOptions): Promise<WifiDebugResult<WifiPortCheckResult>> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
      timeout: options.timeoutMs ?? 5000,
    })

    function finish(open: boolean, message: string): void {
      socket.destroy()
      resolve(ok(message, {
        host: options.host,
        port: options.port,
        open,
        latencyMs: Date.now() - startedAt,
      }))
    }

    socket.once('connect', () => finish(true, 'TCP 端口可访问'))
    socket.once('timeout', () => finish(false, 'TCP 端口检查超时'))
    socket.once('error', (error) => finish(false, `TCP 端口不可访问：${error.message}`))
  })
}

export async function requestWifiHttp(options: WifiHttpRequestOptions): Promise<WifiDebugResult<WifiHttpRequestResult>> {
  const normalizedPath = options.path.startsWith('/') ? options.path : `/${options.path}`
  const url = `http://${options.host}:${options.port}${normalizedPath}`
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const body = await response.text()
    let json: unknown | null = null
    try {
      json = JSON.parse(body)
    } catch {
      json = null
    }

    return ok(response.ok ? 'HTTP 请求成功' : `HTTP 请求返回 ${response.status}`, {
      url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      latencyMs: Date.now() - startedAt,
      body,
      json,
    })
  } catch (error) {
    return errorResult(error, 'WIFI_HTTP_ERROR')
  } finally {
    clearTimeout(timer)
  }
}
