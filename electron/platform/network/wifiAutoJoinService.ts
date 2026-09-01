import type { DeviceDefinition, WifiDebugStatus } from '../../../src/shared/types'
import { connectWifiNetwork, disconnectWifiNetwork, getWifiDebugStatus, scanWifiNetworks } from './wifiDebugService'
import { probeInsta360ControlResponse } from '../../devices/insta360/insta360TcpProtocol'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

export interface WifiAutoJoinResult {
  attempted: boolean
  connected: boolean
  ssid?: string
  wifiPasswordRequired?: boolean
  message: string
}

export interface WifiCameraEndpoint {
  host: string
  port: number
  protocol: 'insta360-stream'
}

interface WifiRestoreSession {
  cameraSsid: string
  previousSsid: string | null
}

const restoreSessions = new Map<string, WifiRestoreSession>()
const CAMERA_HANDSHAKE_WAIT_MS = 10000
const CAMERA_HANDSHAKE_RETRY_DELAY_MS = 250

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
): Promise<{ ok: boolean; lastError: string | null }> {
  const startedAt = Date.now()
  const deadline = startedAt + CAMERA_HANDSHAKE_WAIT_MS
  let attempts = 0
  let lastError: string | null = null
  while (Date.now() < deadline) {
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

async function waitForLunaWifiAddress(
  sessionKey: string,
): Promise<{ address: string; ssid: string | null } | null> {
  const startedAt = Date.now()
  const deadline = startedAt + CAMERA_HANDSHAKE_WAIT_MS
  let attempts = 0
  while (Date.now() < deadline) {
    attempts += 1
    const status = await getWifiDebugStatus().catch(() => null)
    if (status?.success && hasLunaWifiAddress(status.data)) {
      const address = [
        status.data?.ipAddress,
        ...(status.data?.ipAddresses ?? []).map((item) => item.address),
      ].find((item): item is string => Boolean(item) && isLunaWifiAddress(item))
      if (address) {
        logMainInfo('[设备 Wi-Fi] 已获取 Luna 网段地址', {
          sessionKey,
          address,
          ssid: status.data?.ssid,
          attempts,
          elapsedMs: Date.now() - startedAt,
        })
        return { address, ssid: status.data?.ssid ?? null }
      }
    }
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
): Promise<WifiAutoJoinResult> {
  if ((process.platform !== 'darwin' && process.platform !== 'win32') || !config?.autoJoin || config.ssidIncludes.length === 0) {
    return skipped('未启用设备 Wi-Fi 自动连接')
  }

  logMainInfo('[设备 Wi-Fi] 开始自动连接', {
    sessionKey,
    matchRule: config.ssidIncludes,
  })
  const current = await getWifiDebugStatus().catch(() => null)
  const currentSsid = current?.success ? current.data?.ssid : null
  if (hasLunaWifiAddress(current?.data)) {
    const localAddress = [
      current?.data?.ipAddress,
      ...(current?.data?.ipAddresses ?? []).map((item) => item.address),
    ].find((address): address is string => address != null && isLunaWifiAddress(address))
    logMainInfo('[设备 Wi-Fi] 当前地址已在 Luna 网段，跳过系统 Wi-Fi 切换', {
      sessionKey,
      localAddress,
      ssid: currentSsid,
    })
    if (endpoint) {
      const handshake = await waitForCameraHandshake(endpoint, sessionKey)
      if (!handshake.ok) {
        logMainWarn('[设备 Wi-Fi] Luna 网段地址存在但控制握手未通过，继续执行 Wi-Fi 准备', {
          sessionKey,
          localAddress,
          host: endpoint.host,
          port: endpoint.port,
          error: handshake.lastError,
        })
      } else {
        return {
          attempted: false,
          connected: true,
          ssid: currentSsid ?? undefined,
          message: `已连接 Luna Wi-Fi${localAddress ? `（本机地址 ${localAddress}）` : ''}`,
        }
      }
    } else {
      return {
        attempted: false,
        connected: true,
        ssid: currentSsid ?? undefined,
        message: `已连接 Luna Wi-Fi${localAddress ? `（本机地址 ${localAddress}）` : ''}`,
      }
    }
  }
  if (currentSsid && matchesConfiguredSsid(currentSsid, config.ssidIncludes) && hasLunaWifiAddress(current?.data)) {
    logMainInfo('[设备 Wi-Fi] 当前已连接目标网络，开始控制通道确认', { sessionKey, ssid: currentSsid })
    if (endpoint) {
      const handshake = await waitForCameraHandshake(endpoint, sessionKey)
      if (handshake.ok) {
        return { attempted: false, connected: true, ssid: currentSsid, message: `已连接设备 Wi-Fi：${currentSsid}` }
      }
      logMainWarn('[设备 Wi-Fi] 当前 SSID 匹配但控制握手未通过，继续执行 Wi-Fi 准备', {
        sessionKey,
        ssid: currentSsid,
        host: endpoint.host,
        port: endpoint.port,
        error: handshake.lastError,
      })
    } else {
      return { attempted: false, connected: true, ssid: currentSsid, message: `已连接设备 Wi-Fi：${currentSsid}` }
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
  })
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
    const message = `${joined.message}。请检查 ${candidateSsid} 的 Wi-Fi 名称和密码`
    return {
      attempted: true,
      connected: false,
      ssid: candidateSsid,
      wifiPasswordRequired,
      message,
    }
  }

  const joinedSsid = joined.data?.ssid
  const network = await waitForLunaWifiAddress(sessionKey)
  if (!network) {
    return {
      attempted: true,
      connected: false,
      ssid: candidateSsid,
      wifiPasswordRequired: true,
      message: `已尝试连接 ${candidateSsid}，但本机未获取 Luna Wi-Fi 地址（192.168.42.x），未建立相机连接`,
    }
  }
  if (network.ssid && network.ssid.trim().toLocaleLowerCase() !== candidateSsid.trim().toLocaleLowerCase()) {
    logMainWarn('[设备 Wi-Fi] 当前 SSID 与目标网络不一致', {
      sessionKey,
      targetSsid: candidateSsid,
      currentSsid: network.ssid,
      address: network.address,
    })
    return {
      attempted: true,
      connected: false,
      ssid: network.ssid,
      wifiPasswordRequired: true,
      message: `当前 Wi-Fi 为 ${network.ssid}，不是目标网络 ${candidateSsid}`,
    }
  }
  if (endpoint) {
    const handshake = await waitForCameraHandshake(endpoint, sessionKey)
    if (!handshake.ok) {
      return {
        attempted: true,
        connected: false,
        ssid: candidateSsid,
        wifiPasswordRequired: true,
        message: `已尝试连接 ${candidateSsid}，但未能通过相机控制通道确认连接。请检查 Wi-Fi 密码后重试`,
      }
    }
  }

  restoreSessions.set(sessionKey, {
    cameraSsid: candidateSsid,
    previousSsid: currentSsid ?? null,
  })

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

/**
 * 恢复自动切换前的 Wi-Fi。只有当前仍是相机热点时才执行，避免覆盖用户在连接期间的手动选择。
 */
export async function restoreDeviceWifi(sessionKey = 'default'): Promise<WifiAutoJoinResult> {
  const session = restoreSessions.get(sessionKey)
  if (!session) return skipped('没有需要恢复的设备 Wi-Fi')
  restoreSessions.delete(sessionKey)

  logMainInfo('[设备 Wi-Fi] 准备恢复连接前网络', { sessionKey, cameraSsid: session.cameraSsid, previousSsid: session.previousSsid })

  const current = await getWifiDebugStatus().catch(() => null)
  const currentSsid = current?.success ? current.data?.ssid : null
  if (currentSsid !== session.cameraSsid) {
    logMainInfo('[设备 Wi-Fi] 用户已切换网络，不执行恢复', { sessionKey, cameraSsid: session.cameraSsid, currentSsid })
    return {
      attempted: false,
      connected: Boolean(currentSsid),
      ssid: currentSsid ?? undefined,
      message: currentSsid
        ? `当前 Wi-Fi 已由用户切换为 ${currentSsid}，不覆盖手动选择`
        : '当前未连接 Wi-Fi，不覆盖手动选择',
    }
  }

  if (!session.previousSsid) {
    const result = await disconnectWifiNetwork()
    logMainInfo('[设备 Wi-Fi] 已处理原网络为空的恢复', { sessionKey, success: result.success, message: result.message })
    return {
      attempted: true,
      connected: false,
      ssid: undefined,
      message: result.success ? '已断开相机 Wi-Fi' : `恢复原 Wi-Fi 失败：${result.message}`,
    }
  }

  const result = await connectWifiNetwork({ ssid: session.previousSsid })
  logMainInfo('[设备 Wi-Fi] 恢复原网络完成', { sessionKey, ssid: session.previousSsid, success: result.success, message: result.message })
  return {
    attempted: true,
    connected: result.success,
    ssid: session.previousSsid,
    message: result.success
      ? `已恢复原 Wi-Fi：${session.previousSsid}`
      : `恢复原 Wi-Fi 失败：${result.message}`,
  }
}
