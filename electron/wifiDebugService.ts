import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  WifiConnectOptions,
  WifiDebugNetwork,
  WifiDebugResult,
  WifiDebugStatus,
  WifiHttpRequestOptions,
  WifiHttpRequestResult,
  WifiPortCheckOptions,
  WifiPortCheckResult,
} from '../src/shared/types'

const execFileAsync = promisify(execFile)
const DEFAULT_WIFI_TIMEOUT_MS = 15000
const COREWLAN_HELPER_PATH = path.join(process.env.APP_ROOT || process.cwd(), 'electron', 'wifiCoreWlan.swift')

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

function parseWindowsStatus(raw: string, ipAddress: string | null): WifiDebugStatus {
  const field = (name: string): string | null => {
    const match = raw.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'mi'))
    return match?.[1]?.trim() || null
  }
  const state = field('State')
  const ssid = field('SSID')
  return {
    platform: process.platform,
    interfaceName: field('Name'),
    connected: Boolean(state?.toLowerCase().includes('connected') && ssid),
    ssid,
    bssid: field('BSSID'),
    signal: field('Signal'),
    security: field('Authentication'),
    ipAddress,
    raw,
  }
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

function normalizeWifiStatus(value: any, raw?: string): WifiDebugStatus {
  return {
    platform: value?.platform ?? process.platform,
    interfaceName: value?.interfaceName ?? null,
    connected: Boolean(value?.connected),
    ssid: value?.ssid ?? null,
    bssid: value?.bssid ?? null,
    signal: value?.signal ?? null,
    security: value?.security ?? null,
    ipAddress: value?.ipAddress ?? null,
    raw,
  }
}

function normalizeWifiNetwork(value: any): WifiDebugNetwork {
  return {
    ssid: String(value?.ssid ?? ''),
    bssid: value?.bssid ?? null,
    signal: value?.signal ?? null,
    security: value?.security ?? null,
    channel: value?.channel ?? null,
    raw: typeof value?.raw === 'string' ? value.raw : JSON.stringify(value?.raw ?? {}),
  }
}

async function runCoreWlan<T>(args: string[], timeoutMs = DEFAULT_WIFI_TIMEOUT_MS): Promise<WifiDebugResult<T>> {
  if (!existsSync(COREWLAN_HELPER_PATH)) {
    return fail('未找到 CoreWLAN helper', 'COREWLAN_HELPER_NOT_FOUND')
  }

  const raw = await runCommand('swift', [COREWLAN_HELPER_PATH, ...args], timeoutMs)
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    return fail('CoreWLAN helper 未返回 JSON', 'COREWLAN_INVALID_JSON', raw)
  }
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as WifiDebugResult<T>
  return { ...parsed, raw }
}

export async function getWifiDebugStatus(): Promise<WifiDebugResult<WifiDebugStatus>> {
  try {
    if (process.platform === 'darwin') {
      const result = await runCoreWlan<any>(['status'], 12000)
      if (!result.success) return result as WifiDebugResult<WifiDebugStatus>
      const status = normalizeWifiStatus(result.data, result.raw)
      return ok(result.message, { ...status, ipAddress: status.ipAddress ?? firstWirelessIpv4() }, result.raw)
    }

    if (process.platform === 'win32') {
      const raw = await runCommand('netsh', ['wlan', 'show', 'interfaces'], 8000)
      return ok('Wi-Fi 状态已刷新', parseWindowsStatus(raw, firstWirelessIpv4()), raw)
    }

    return unsupported()
  } catch (error) {
    return errorResult(error)
  }
}

export async function scanWifiNetworks(): Promise<WifiDebugResult<WifiDebugNetwork[]>> {
  try {
    if (process.platform === 'darwin') {
      const result = await runCoreWlan<any[]>(['scan'], 30000)
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
      const args = ['connect', '--ssid', ssid]
      if (options.password) args.push('--password', options.password)
      if (options.bssid) args.push('--bssid', options.bssid)
      const result = await runCoreWlan<any>(args, timeoutMs)
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
      const result = await runCoreWlan<any>(['disconnect'], 12000)
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
