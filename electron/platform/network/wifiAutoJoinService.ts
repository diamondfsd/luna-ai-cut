import type { DeviceDefinition, WifiDebugStatus } from '../../../src/shared/types'
import { connectWifiNetwork, disconnectWifiNetwork, getWifiDebugStatus, scanWifiNetworks } from './wifiDebugService'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'

export interface WifiAutoJoinResult {
  attempted: boolean
  connected: boolean
  ssid?: string
  wifiPasswordRequired?: boolean
  message: string
}

interface WifiRestoreSession {
  cameraSsid: string
  previousSsid: string | null
}

const restoreSessions = new Map<string, WifiRestoreSession>()

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

/**
 * 仅按设备定义发现目标热点。本机已有 Luna 网段地址时直接视为已经连好网络；
 * 其他情况必须由用户输入密码后再尝试连接。
 */
export async function autoJoinDeviceWifi(
  config?: DeviceDefinition['wifi'],
  sessionKey = 'default',
  password?: string,
  requestedSsid?: string,
): Promise<WifiAutoJoinResult> {
  if (process.platform !== 'darwin' || !config?.autoJoin || config.ssidIncludes.length === 0) {
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
    return {
      attempted: false,
      connected: true,
      ssid: currentSsid ?? undefined,
      message: `已连接 Luna Wi-Fi${localAddress ? `（本机地址 ${localAddress}）` : ''}`,
    }
  }
  if (currentSsid && matchesConfiguredSsid(currentSsid, config.ssidIncludes)) {
    logMainInfo('[设备 Wi-Fi] 当前已连接目标网络', { sessionKey, ssid: currentSsid })
    return { attempted: false, connected: true, ssid: currentSsid, message: `已连接设备 Wi-Fi：${currentSsid}` }
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
    connectionStrategy: 'corewlan-password-stdin',
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
  if (joinedSsid && joinedSsid !== candidateSsid && !matchesConfiguredSsid(joinedSsid, config.ssidIncludes)) {
    logMainWarn('[设备 Wi-Fi] 切换结果未匹配目标', {
      sessionKey,
      targetSsid: candidateSsid,
      joinedSsid,
    })
    return {
      attempted: true,
      connected: false,
      ssid: candidateSsid,
      message: `系统未切换到目标 Wi-Fi，当前网络为 ${joinedSsid}（目标：${candidateSsid}）`,
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
