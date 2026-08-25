import type { DeviceDefinition } from '../../../src/shared/types'
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

function skipped(message: string): WifiAutoJoinResult {
  return { attempted: false, connected: false, message }
}

function matchRule(config: DeviceDefinition['wifi']): string {
  return config?.ssidIncludes.join('、') || '未配置'
}

function usesSavedNetworkCredentials(security: string | null): boolean {
  return Boolean(security && /(WEP|WPA|Personal|Enterprise)/i.test(security))
}

/**
 * 仅按设备定义发现目标热点。未提供密码时由 CoreWLAN 从 macOS 已保存的 Wi-Fi
 * 配置读取凭据后关联；只有确认当前 SSID 后才算连接成功。
 * 设备没有匹配热点时不阻断后续连接，允许用户已经在系统中手动连好网络。
 */
export async function autoJoinDeviceWifi(
  config?: DeviceDefinition['wifi'],
  sessionKey = 'default',
  password?: string,
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
  if (currentSsid && matchesConfiguredSsid(currentSsid, config.ssidIncludes)) {
    logMainInfo('[设备 Wi-Fi] 当前已连接目标网络', { sessionKey, ssid: currentSsid })
    return { attempted: false, connected: true, ssid: currentSsid, message: `已连接设备 Wi-Fi：${currentSsid}` }
  }

  const scan = await scanWifiNetworks(10000)
  if (!scan.success) {
    logMainWarn('[设备 Wi-Fi] 扫描失败', {
      sessionKey,
      matchRule: config.ssidIncludes,
      code: scan.code,
      message: scan.message,
    })
    return skipped(`设备 Wi-Fi 扫描失败（匹配规则：${matchRule(config)}）：${scan.message}`)
  }

  const candidate = (scan.data ?? []).find((network) => matchesConfiguredSsid(network.ssid, config.ssidIncludes))
  if (!candidate) {
    logMainWarn('[设备 Wi-Fi] 未发现匹配网络', {
      sessionKey,
      matchRule: config.ssidIncludes,
      scannedSsids: (scan.data ?? []).map((network) => network.ssid),
      currentSsid,
    })
    return skipped(`未发现匹配的设备 Wi-Fi（匹配规则：${matchRule(config)}），当前网络未切换`)
  }

  logMainInfo('[设备 Wi-Fi] 找到目标网络，准备连接', {
    sessionKey,
    ssid: candidate.ssid,
    currentSsid,
    security: candidate.security,
    credentialSource: password
      ? 'user-provided-wifi-password'
      : usesSavedNetworkCredentials(candidate.security) ? 'macos-saved-wifi' : 'corewlan',
    connectionStrategy: password
      ? 'networksetup-with-save'
      : usesSavedNetworkCredentials(candidate.security) ? 'corewlan-with-keychain' : 'corewlan-with-retry',
  })
  const joined = await connectWifiNetwork({
    ssid: candidate.ssid,
    timeoutMs: usesSavedNetworkCredentials(candidate.security) ? 60000 : 30000,
    password,
    savedNetworkOnly: !password,
    requireSavedPassword: !password && usesSavedNetworkCredentials(candidate.security),
  })
  logMainInfo('[设备 Wi-Fi] 系统配置连接结果', {
    sessionKey,
    ssid: candidate.ssid,
    success: joined.success,
    code: joined.code,
    message: joined.message,
  })
  if (!joined.success) {
    const wifiPasswordRequired = usesSavedNetworkCredentials(candidate.security)
    logMainWarn('[设备 Wi-Fi] 切换失败', {
      sessionKey,
      ssid: candidate.ssid,
      code: joined.code,
      message: joined.message,
    })
    const message = wifiPasswordRequired
      ? `${joined.message}。请输入 ${candidate.ssid} 的 Wi-Fi 密码`
      : `自动切换到 ${candidate.ssid} 失败：${joined.message}。请在系统 Wi-Fi 设置中点选该网络后重试`
    return {
      attempted: true,
      connected: false,
      ssid: candidate.ssid,
      wifiPasswordRequired,
      message,
    }
  }

  const joinedSsid = joined.data?.ssid
  if (joinedSsid && !matchesConfiguredSsid(joinedSsid, config.ssidIncludes)) {
    logMainWarn('[设备 Wi-Fi] 切换结果未匹配目标', {
      sessionKey,
      targetSsid: candidate.ssid,
      joinedSsid,
    })
    return {
      attempted: true,
      connected: false,
      ssid: candidate.ssid,
      message: `系统未切换到设备 Wi-Fi，当前网络为 ${joinedSsid}（目标：${candidate.ssid}）`,
    }
  }

  restoreSessions.set(sessionKey, {
    cameraSsid: candidate.ssid,
    previousSsid: currentSsid ?? null,
  })

  logMainInfo('[设备 Wi-Fi] 自动连接成功', {
    sessionKey,
    targetSsid: candidate.ssid,
    joinedSsid: joinedSsid ?? candidate.ssid,
  })
  return {
    attempted: true,
    connected: true,
    ssid: candidate.ssid,
    message: `已自动连接设备 Wi-Fi：${candidate.ssid}`,
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
