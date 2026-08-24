import type { DeviceDefinition } from '../../../src/shared/types'
import { connectWifiNetwork, getWifiDebugStatus, scanWifiNetworks } from './wifiDebugService'

export interface WifiAutoJoinResult {
  attempted: boolean
  connected: boolean
  ssid?: string
  message: string
}

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

/**
 * 仅按设备定义发现目标热点。密码为空时由 CoreWLAN 使用系统已保存的网络凭据。
 * 设备没有匹配热点时不阻断后续连接，允许用户已经在系统中手动连好网络。
 */
export async function autoJoinDeviceWifi(config?: DeviceDefinition['wifi']): Promise<WifiAutoJoinResult> {
  if (process.platform !== 'darwin' || !config?.autoJoin || config.ssidIncludes.length === 0) {
    return skipped('未启用设备 Wi-Fi 自动连接')
  }

  const current = await getWifiDebugStatus().catch(() => null)
  const currentSsid = current?.success ? current.data?.ssid : null
  if (currentSsid && matchesConfiguredSsid(currentSsid, config.ssidIncludes)) {
    return { attempted: false, connected: true, ssid: currentSsid, message: `已连接设备 Wi-Fi：${currentSsid}` }
  }

  const scan = await scanWifiNetworks(10000)
  if (!scan.success) return skipped(`设备 Wi-Fi 扫描失败：${scan.message}`)

  const candidate = (scan.data ?? []).find((network) => matchesConfiguredSsid(network.ssid, config.ssidIncludes))
  if (!candidate) return skipped('未发现设备 Wi-Fi，将继续使用当前系统网络')

  const joined = await connectWifiNetwork({ ssid: candidate.ssid })
  if (!joined.success) {
    return {
      attempted: true,
      connected: false,
      ssid: candidate.ssid,
      message: `${joined.message}。请在系统 Wi-Fi 设置中连接 ${candidate.ssid}`,
    }
  }

  const joinedSsid = joined.data?.ssid
  if (joinedSsid && !matchesConfiguredSsid(joinedSsid, config.ssidIncludes)) {
    return {
      attempted: true,
      connected: false,
      ssid: candidate.ssid,
      message: `系统未切换到设备 Wi-Fi，当前网络为 ${joinedSsid}`,
    }
  }

  return {
    attempted: true,
    connected: true,
    ssid: candidate.ssid,
    message: `已自动连接设备 Wi-Fi：${candidate.ssid}`,
  }
}
