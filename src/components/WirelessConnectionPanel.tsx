import { Bluetooth, Check, Copy, Wifi } from 'lucide-react'

import type { CameraMediaSourcePreparationResult } from '../shared/types'
import { Button } from '../ui'
import '../styles/device-connect-wireless.css'

interface WirelessConnectionPanelProps {
  deviceName: string
  preparation: CameraMediaSourcePreparationResult | null
  credentials: CameraMediaSourcePreparationResult['credentials'] | null
  needsSystemWifi: boolean
  manualWifiConnectionRequired: boolean
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
  manualWifiConnectionRequired,
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
              ? manualWifiConnectionRequired ? '请在系统 Wi-Fi 中连接此热点' : '已获取 Wi-Fi'
              : bluetoothUnsupported
                ? '未检测到蓝牙，请在系统 Wi-Fi 中连接相机热点'
                : preparation
                  ? preparation.message
                  : '点击“开始连接”自动获取 Wi-Fi'}
          </span>
        </div>
        <div className="device-connect-wireless-header-actions">
          <span className={`device-connect-wireless-state ${manualWifiConnectionRequired || needsSystemWifi ? 'system' : hasCredentials ? 'success' : ''}`}>
            {manualWifiConnectionRequired || needsSystemWifi ? <Wifi size={13} /> : <Bluetooth size={13} />}
            {manualWifiConnectionRequired ? '需要手动连接' : hasCredentials ? '蓝牙已获取' : needsSystemWifi ? '需要系统 Wi-Fi' : '自动尝试蓝牙'}
          </span>
          <Button
            variant="secondary"
            size="mini"
            disabled={loading}
            onClick={onReadWifi}
            icon={<Bluetooth size={13} />}
          >
            {loading ? '正在获取' : bluetoothUnsupported ? '重新检测蓝牙' : hasCredentials ? '重新获取密码' : '获取密码'}
          </Button>
        </div>
      </div>

      {credentials && (
        <div className="device-connect-wireless-credentials">
          <div><span>Wi-Fi 名称</span><strong title={credentials.ssid}>{credentials.ssid}</strong></div>
          <div>
            <span>Wi-Fi 密码</span>
            <strong aria-label={credentials.password ? 'Wi-Fi 密码已隐藏' : '无密码'}>
              {credentials.password ? '••••••••' : '无密码'}
            </strong>
          </div>
          <Button
            variant="ghost"
            size="mini"
            onClick={onCopyPassword}
            disabled={!credentials.password}
            icon={wifiPasswordCopied ? <Check size={13} /> : <Copy size={13} />}
          >
            {wifiPasswordCopied ? '已复制密码' : '复制密码'}
          </Button>
        </div>
      )}

      {needsSystemWifi && (
        <div className="device-connect-wireless-system">
          <p className="device-connect-section-title">需要手动连接</p>
          <p>
            请在系统 Wi-Fi 中连接相机热点。
          </p>
        </div>
      )}
    </section>
  )
}
