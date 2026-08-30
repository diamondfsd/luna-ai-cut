import { Bluetooth, Check, Copy } from 'lucide-react'

import type { CameraMediaSourcePreparationResult } from '../shared/types'
import { Button } from '../ui'
import '../styles/device-connect-wireless.css'

interface WirelessConnectionPanelProps {
  deviceName: string
  preparation: CameraMediaSourcePreparationResult | null
  credentials: CameraMediaSourcePreparationResult['credentials'] | null
  needsSystemWifi: boolean
  wifiPasswordCopied: boolean
  onCopyPassword: () => void
  loading: boolean
  onReadWifi: () => void
}

export function WirelessConnectionPanel({
  deviceName,
  preparation,
  credentials,
  needsSystemWifi,
  wifiPasswordCopied,
  onCopyPassword,
  loading,
  onReadWifi,
}: WirelessConnectionPanelProps) {
  const bluetoothUnsupported = preparation?.capabilities?.bluetoothWifiCredentials === false
  const hasCredentials = Boolean(credentials)

  return (
    <section className="device-connect-wireless-preparation" aria-label={`${deviceName} Wi-Fi 连接准备`}>
      <div className="device-connect-wireless-preparation-header">
        <div>
          <p className="device-connect-section-title">Wi-Fi 连接准备</p>
          <span>
            {hasCredentials
              ? '已通过蓝牙取得相机 Wi-Fi 信息，点击连接时会自动切换到相机 Wi-Fi'
              : bluetoothUnsupported
                ? '未检测到可用蓝牙，请打开系统 Wi-Fi 设置手动连接相机热点，连接完成后再点击“开始连接”'
                : preparation
                  ? preparation.message
                  : '点击“开始连接”后会自动尝试通过蓝牙获取相机 Wi-Fi 信息'}
          </span>
        </div>
        <div className="device-connect-wireless-header-actions">
          <span className={`device-connect-wireless-state ${hasCredentials ? 'success' : needsSystemWifi ? 'system' : ''}`}>
            <Bluetooth size={13} />
            {hasCredentials ? '蓝牙已获取' : needsSystemWifi ? '需要系统 Wi-Fi' : '自动尝试蓝牙'}
          </span>
          <Button
            variant="secondary"
            size="mini"
            disabled={loading}
            onClick={onReadWifi}
            icon={<Bluetooth size={13} />}
          >
            {loading ? '正在获取' : bluetoothUnsupported ? '重新检测蓝牙' : hasCredentials ? '重新获取密码' : '蓝牙一键获取 Wi-Fi 密码'}
          </Button>
        </div>
      </div>

      {credentials && (
        <div className="device-connect-wireless-credentials">
          <div><span>Wi-Fi 名称</span><strong title={credentials.ssid}>{credentials.ssid}</strong></div>
          <div><span>Wi-Fi 密码</span><strong>{credentials.password || '无密码'}</strong></div>
          <Button
            variant="ghost"
            size="mini"
            onClick={onCopyPassword}
            icon={wifiPasswordCopied ? <Check size={13} /> : <Copy size={13} />}
          >
            {wifiPasswordCopied ? '已复制密码' : '复制密码'}
          </Button>
        </div>
      )}

      {needsSystemWifi && (
        <div className="device-connect-wireless-system">
          <p className="device-connect-section-title">请使用系统 Wi-Fi 连接工具</p>
          <p>
            点击上方“打开 Wi-Fi 设置”，在系统中手动连接相机热点。连接完成后返回应用，再点击“开始连接”；应用不会自动切换系统网络。
          </p>
        </div>
      )}
    </section>
  )
}
