import type { DeviceDefinition, WifiDebugStatus } from '../../../src/shared/types'
import { connectWifiNetwork, getWifiDebugStatus, scanWifiNetworks } from './wifiDebugService'
import { probeInsta360ControlResponse } from '../../devices/insta360/insta360TcpProtocol'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

export interface WifiAutoJoinResult {
  attempted: boolean
  connected: boolean
  ssid?: string
  wifiPasswordRequired?: boolean
  wifiManualConnectionRequired?: boolean
  cancelled?: boolean
  message: string
}

export interface WifiCameraEndpoint {
  host: string
  port: number
  protocol: 'insta360-stream'
}

const CAMERA_HANDSHAKE_WAIT_MS = 10000
const CAMERA_HANDSHAKE_RETRY_DELAY_MS = 250
const INITIAL_CAMERA_PROBE_TIMEOUT_MS = 1500

function matchesConfiguredSsid(ssid: string, includes: string[]): boolean {
  const normalized = ssid.trim().toLocaleLowerCase()
  return includes.some((value) => {
    const fragment = value.trim().toLocaleLowerCase()
    return fragment.length > 0 && normalized.includes(fragment)
  })
}

function skipped(message: string, wifiPasswordRequired = false): WifiAutoJoinResult {
  return { attempted: false, connected: false, wifiPasswordRequired, message }
}

function cancelled(): WifiAutoJoinResult {
  return { attempted: false, connected: false, cancelled: true, message: '设备连接已取消' }
}

function isLunaWifiAddress(address: string): boolean {
  const match = address.trim().match(/^192\.168\.42\.(\d{1,3})$/)
  return Boolean(match && Number(match[1]) <= 255)
}

function hasLunaWifiAddress(status?: WifiDebugStatus): boolean {
  const addresses = [
    status?.ipAddress,
    ...(status?.ipAddresses ?? []).map((item) => item.address),
  ].filter((address): address is string => Boolean(address))
  return addresses.some(isLunaWifiAddress)
}

async function waitForCameraHandshake(
  endpoint: WifiCameraEndpoint,
  sessionKey: string,
  isCancelled?: () => boolean,
): Promise<{ ok: boolean; lastError: string | null }> {
  const startedAt = Date.now()
  const deadline = startedAt + CAMERA_HANDSHAKE_WAIT_MS
  let attempts = 0
  let lastError: string | null = null
  while (Date.now() < deadline) {
    if (isCancelled?.()) return { ok: false, lastError: '设备连接已取消' }
    attempts += 1
    try {
      const response = await probeInsta360ControlResponse(endpoint.host, endpoint.port)
      if (response.code !== 200) throw new Error(`Luna 控制指令返回 ${response.code}`)
      logMainInfo('[设备 Wi-Fi] 相机控制通道握手成功', {
        sessionKey,
        host: endpoint.host,
        port: endpoint.port,
        responseCode: response.code,
        attempts,
        elapsedMs: Date.now() - startedAt,
      })
      return { ok: true, lastError: null }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      logMainInfo('[设备 Wi-Fi] 相机控制通道尚不可用，继续等待', {
        sessionKey,
        host: endpoint.host,
        port: endpoint.port,
        attempt: attempts,
        elapsedMs: Date.now() - startedAt,
        error: lastError,
      })
    }
    if (isCancelled?.()) return { ok: false, lastError: '设备连接已取消' }
    await new Promise((resolve) => setTimeout(resolve, CAMERA_HANDSHAKE_RETRY_DELAY_MS))
  }
  logMainWarn('[设备 Wi-Fi] 相机控制通道握手失败', {
    sessionKey,
    host: endpoint.host,
    port: endpoint.port,
    attempts,
    elapsedMs: Date.now() - startedAt,
    error: lastError,
  })
  return { ok: false, lastError }
}

async function probeCameraEndpoint(endpoint: WifiCameraEndpoint, sessionKey: string): Promise<boolean> {
  const startedAt = Date.now()
  try {
    const response = await probeInsta360ControlResponse(endpoint.host, endpoint.port, INITIAL_CAMERA_PROBE_TIMEOUT_MS)
    if (response.code !== 200) throw new Error(`Luna 控制指令返回 ${response.code}`)
    logMainInfo('[设备 Wi-Fi] 目标控制通道可达，跳过 Wi-Fi 检测', {
      sessionKey,
      host: endpoint.host,
      port: endpoint.port,
      responseCode: response.code,
      elapsedMs: Date.now() - startedAt,
    })
    return true
  } catch (error) {
    logMainInfo('[设备 Wi-Fi] 目标控制通道暂不可达，继续 Wi-Fi 准备', {
      sessionKey,
      host: endpoint.host,
      port: endpoint.port,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function waitForLunaWifiAddress(
  sessionKey: string,
  isCancelled?: () => boolean,
): Promise<{ address: string } | null> {
  const startedAt = Date.now()
  const deadline = startedAt + CAMERA_HANDSHAKE_WAIT_MS
  let attempts = 0
  while (Date.now() < deadline) {
    if (isCancelled?.()) return null
    attempts += 1
    const status = await getWifiDebugStatus().catch(() => null)
    if (status?.success && hasLunaWifiAddress(status.data)) {
      const address = [
        status.data?.ipAddress,
        ...(status.data?.ipAddresses ?? []).map((item) => item.address),
      ].find((item): item is string => typeof item === 'string' && isLunaWifiAddress(item))
      if (address) {
        logMainInfo('[设备 Wi-Fi] 已获取 Luna 网段地址', {
          sessionKey,
          address,
          attempts,
          elapsedMs: Date.now() - startedAt,
        })
        return { address }
      }
    }
    if (isCancelled?.()) return null
    await new Promise((resolve) => setTimeout(resolve, CAMERA_HANDSHAKE_RETRY_DELAY_MS))
  }
  logMainWarn('[设备 Wi-Fi] 切换后未获取 Luna 网段地址', {
    sessionKey,
    attempts,
    elapsedMs: Date.now() - startedAt,
  })
  return null
}

/**
 * 仅按设备定义发现目标热点。本机已有 Luna 网段地址时直接视为已经连好网络；
 * 其他情况必须由用户输入密码后再尝试连接。
 */
export async function autoJoinDeviceWifi(
  config?: DeviceDefinition['wifi'],
  sessionKey = 'default',
  password?: string,
  requestedSsid?: string,
  endpoint?: WifiCameraEndpoint,
  isCancelled?: () => boolean,
  signal?: AbortSignal,
): Promise<WifiAutoJoinResult> {
  const cancelledByCaller = (): boolean => Boolean(signal?.aborted || isCancelled?.())
  if ((process.platform !== 'darwin' && process.platform !== 'win32') || !config?.autoJoin || config.ssidIncludes.length === 0) {
    return skipped('未启用设备 Wi-Fi 自动连接')
  }
  if (cancelledByCaller()) return cancelled()

  logMainInfo('[设备 Wi-Fi] 开始自动连接', {
    sessionKey,
    matchRule: config.ssidIncludes,
  })

  if (endpoint && await probeCameraEndpoint(endpoint, sessionKey)) {
    if (cancelledByCaller()) return cancelled()
    return {
      attempted: false,
      connected: true,
      message: '已检测到相机网络',
    }
  }

  const current = await getWifiDebugStatus().catch(() => null)
  if (cancelledByCaller()) return cancelled()
  const currentSsid = current?.success ? current.data?.ssid : null
  if (hasLunaWifiAddress(current?.data)) {
    const localAddress = [
      current?.data?.ipAddress,
      ...(current?.data?.ipAddresses ?? []).map((item) => item.address),
    ].find((address): address is string => address != null && isLunaWifiAddress(address))
    logMainInfo('[设备 Wi-Fi] 当前地址已在 Luna 网段，跳过系统 Wi-Fi 切换', {
      sessionKey,
      localAddress,
    })
    return {
      attempted: false,
      connected: true,
      ssid: currentSsid ?? undefined,
      message: `已连接设备 Wi-Fi${currentSsid ? `：${currentSsid}` : ''}${localAddress ? `（本机地址 ${localAddress}）` : ''}`,
    }
  }

  const manualSsid = requestedSsid?.trim()
  let candidateSsid = manualSsid
  let candidateSecurity: string | null = null

  if (!candidateSsid) {
    const scan = await scanWifiNetworks(10000)
    if (!scan.success) {
      logMainWarn('[设备 Wi-Fi] 扫描失败', {
        sessionKey,
        ssidIncludes: config.ssidIncludes,
        code: scan.code,
        message: scan.message,
      })
      return skipped(`未找到设备 Wi-Fi，请输入 Wi-Fi 名称和密码（${scan.message}）`, true)
    }

    const candidate = (scan.data ?? []).find((network) => matchesConfiguredSsid(network.ssid, config.ssidIncludes))
    if (!candidate) {
      logMainWarn('[设备 Wi-Fi] 未发现匹配网络', {
        sessionKey,
        ssidIncludes: config.ssidIncludes,
        scannedSsids: (scan.data ?? []).map((network) => network.ssid),
        currentSsid,
      })
      return skipped('未找到设备 Wi-Fi，请输入 Wi-Fi 名称和密码', true)
    }
    candidateSsid = candidate.ssid
    candidateSecurity = candidate.security
  }

  if (!password) {
    return {
      attempted: false,
      connected: false,
      ssid: candidateSsid,
      wifiPasswordRequired: true,
      message: `请输入 ${candidateSsid} 的 Wi-Fi 密码`,
    }
  }

  logMainInfo('[设备 Wi-Fi] 找到目标网络，准备连接', {
    sessionKey,
    ssid: candidateSsid,
    currentSsid,
    security: candidateSecurity,
    credentialSource: 'user-provided-wifi-password',
    connectionStrategy: process.platform === 'win32' ? 'netsh-profile' : 'corewlan-password-stdin',
  })
  const joined = await connectWifiNetwork({
    ssid: candidateSsid,
    timeoutMs: 30000,
    password,
    // The current system SSID is not reliable on desktop platforms. Luna's
    // control-channel handshake below is the actual connection confirmation.
    skipSsidVerification: true,
  }, signal)
  if (cancelledByCaller()) return cancelled()
  logMainInfo('[设备 Wi-Fi] 系统配置连接结果', {
    sessionKey,
    ssid: candidateSsid,
    success: joined.success,
    code: joined.code,
    message: joined.message,
  })
  if (!joined.success) {
    const wifiPasswordRequired = true
    logMainWarn('[设备 Wi-Fi] 切换失败', {
      sessionKey,
      ssid: candidateSsid,
      code: joined.code,
      message: joined.message,
    })
    return {
      attempted: true,
      connected: false,
      ssid: candidateSsid,
      wifiPasswordRequired,
      wifiManualConnectionRequired: true,
      message: '未能连接到相机 Wi-Fi，请确认相机已开机且密码正确后重试',
    }
  }

  const joinedSsid = joined.data?.ssid
  if (endpoint) {
    const handshake = await waitForCameraHandshake(endpoint, sessionKey, cancelledByCaller)
    if (cancelledByCaller()) return cancelled()
    if (!handshake.ok) {
      const afterHandshake = await getWifiDebugStatus().catch(() => null)
      logMainWarn('[设备 Wi-Fi] 控制握手失败后的网络状态', {
        sessionKey,
        targetSsid: candidateSsid,
        joinedSsid,
        connected: afterHandshake?.success ? afterHandshake.data?.connected : null,
        interfaceName: afterHandshake?.success ? afterHandshake.data?.interfaceName : null,
        bssid: afterHandshake?.success ? afterHandshake.data?.bssid : null,
        ipAddress: afterHandshake?.success ? afterHandshake.data?.ipAddress : null,
        ipAddresses: afterHandshake?.success ? afterHandshake.data?.ipAddresses : null,
        error: handshake.lastError,
      })
      return {
        attempted: true,
        connected: false,
        ssid: candidateSsid,
        wifiPasswordRequired: true,
        wifiManualConnectionRequired: true,
        message: '相机 Wi-Fi 已尝试连接，但相机未响应，请确认相机已开机后重试',
      }
    }
  } else {
    const network = await waitForLunaWifiAddress(sessionKey, cancelledByCaller)
    if (cancelledByCaller()) return cancelled()
    if (!network) {
      const afterAddressWait = await getWifiDebugStatus().catch(() => null)
      logMainWarn('[设备 Wi-Fi] 获取地址失败后的网络状态', {
        sessionKey,
        targetSsid: candidateSsid,
        connected: afterAddressWait?.success ? afterAddressWait.data?.connected : null,
        interfaceName: afterAddressWait?.success ? afterAddressWait.data?.interfaceName : null,
        bssid: afterAddressWait?.success ? afterAddressWait.data?.bssid : null,
        ipAddress: afterAddressWait?.success ? afterAddressWait.data?.ipAddress : null,
        ipAddresses: afterAddressWait?.success ? afterAddressWait.data?.ipAddresses : null,
      })
      return {
        attempted: true,
        connected: false,
        ssid: candidateSsid,
        wifiPasswordRequired: true,
        wifiManualConnectionRequired: true,
        message: '未能获取相机 Wi-Fi 地址，请确认相机已开机且密码正确后重试',
      }
    }
  }

  logMainInfo('[设备 Wi-Fi] 自动连接成功', {
    sessionKey,
    targetSsid: candidateSsid,
    joinedSsid: joinedSsid ?? candidateSsid,
    endpoint: endpoint ? `${endpoint.host}:${endpoint.port}` : null,
  })
  return {
    attempted: true,
    connected: true,
    ssid: candidateSsid,
    message: `已连接设备 Wi-Fi：${candidateSsid}`,
  }
}
