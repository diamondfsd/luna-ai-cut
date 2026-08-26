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
import { getSwiftScriptPath } from '../macos/swiftUtils'

const execFileAsync = promisify(execFile)
const DEFAULT_WIFI_TIMEOUT_MS = 15000
const COREWLAN_HELPER_PATH = getSwiftScriptPath('wifiCoreWlan.swift')

async function runCommand(command: string, args: string[], timeoutMs = DEFAULT_WIFI_TIMEOUT_MS): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: timeoutMs,
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

function runCoreWlanCommand(args: string[], timeoutMs: number, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('swift', [COREWLAN_HELPER_PATH, ...args], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CoreWLAN helper 超时（${timeoutMs}ms）`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.stdin.on('error', () => undefined)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      const raw = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
      if (code !== 0 && !stdout) {
        reject(new Error(raw || `CoreWLAN helper 退出码 ${code ?? '未知'}`))
        return
      }
      resolve(raw)
    })

    if (stdin !== undefined) {
      child.stdin.write(stdin, 'utf8')
    }
    child.stdin.end()
  })
}

async function runCoreWlan<T>(args: string[], timeoutMs = DEFAULT_WIFI_TIMEOUT_MS, stdin?: string): Promise<WifiDebugResult<T>> {
  if (!existsSync(COREWLAN_HELPER_PATH)) {
    return fail('未找到 CoreWLAN helper', 'COREWLAN_HELPER_NOT_FOUND')
  }

  const raw = stdin === undefined
    ? await runCommand('swift', [COREWLAN_HELPER_PATH, ...args], timeoutMs)
    : await runCoreWlanCommand(args, timeoutMs, stdin)
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

/** A password supplied by the user is passed directly to CoreWLAN. */
async function connectDarwinWifiWithPassword(
  ssid: string,
  password: string,
  timeoutMs: number,
  bssid?: string,
): Promise<WifiDebugResult<WifiDebugStatus>> {
  const args = ['connect', '--ssid', ssid, '--password-stdin']
  if (bssid) args.push('--bssid', bssid)
  const result = await runCoreWlan<unknown>(args, Math.min(Math.max(timeoutMs, 10000), 30000), password)
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

export async function connectWifiNetwork(options: WifiConnectOptions): Promise<WifiDebugResult<WifiDebugStatus>> {
  const ssid = options.ssid.trim()
  const timeoutMs = options.timeoutMs ?? DEFAULT_WIFI_TIMEOUT_MS
  if (!ssid) return fail('请输入 SSID', 'SSID_REQUIRED')

  try {
    if (process.platform === 'darwin') {
      if (options.password) {
        return connectDarwinWifiWithPassword(ssid, options.password, timeoutMs, options.bssid)
      }
      const args = ['connect', '--ssid', ssid]
      if (options.bssid) args.push('--bssid', options.bssid)
      const result = await runCoreWlan<unknown>(args, timeoutMs)
      if (!result.success) return result as WifiDebugResult<WifiDebugStatus>
      const status = normalizeWifiStatus(result.data, result.raw)
      return ok(result.message || `CoreWLAN 已尝试连接 ${ssid}`, { ...status, ipAddress: status.ipAddress ?? firstWirelessIpv4() }, result.raw)
    }

    if (process.platform === 'win32') {
      const profilePath = path.join(os.tmpdir(), `luna-wifi-${Date.now()}.xml`)
      await fs.writeFile(profilePath, windowsWifiProfile({ ...options, ssid }), 'utf8')
      try {
        await runCommand('netsh', ['wlan', 'add', 'profile', `filename=${profilePath}`, 'user=current'], timeoutMs)
        const raw = await runCommand('netsh', ['wlan', 'connect', `name=${ssid}`, `ssid=${ssid}`], timeoutMs)
        const status = await getWifiDebugStatus()
        return {
          ...status,
          message: status.success ? `已尝试连接 ${ssid}` : status.message,
          raw,
        }
      } finally {
        await fs.unlink(profilePath).catch(() => undefined)
      }
    }

    return unsupported()
  } catch (error) {
    return errorResult(error, 'WIFI_CONNECT_ERROR')
  }
}

export async function disconnectWifiNetwork(): Promise<WifiDebugResult<WifiDebugStatus>> {
  try {
    if (process.platform === 'darwin') {
      const result = await runCoreWlan<unknown>(['disconnect'], 12000)
      if (!result.success) return result as WifiDebugResult<WifiDebugStatus>
      const status = normalizeWifiStatus(result.data, result.raw)
      return ok(result.message || 'CoreWLAN 已断开当前 Wi-Fi', { ...status, ipAddress: status.ipAddress ?? firstWirelessIpv4() }, result.raw)
    }

    if (process.platform === 'win32') {
      const raw = await runCommand('netsh', ['wlan', 'disconnect'], 8000)
      const status = await getWifiDebugStatus()
      return {
        ...status,
        message: status.success ? '已尝试断开当前 Wi-Fi' : status.message,
        raw,
      }
    }

    return unsupported()
  } catch (error) {
    return errorResult(error, 'WIFI_DISCONNECT_ERROR')
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
