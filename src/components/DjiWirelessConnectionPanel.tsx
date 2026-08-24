import { Bluetooth, Check, Copy } from 'lucide-react'

import type { CameraMediaSourcePreparationResult } from '../shared/types'
import { Button, Input } from '../ui'
import '../styles/device-connect-wireless.css'

interface DjiWirelessConnectionPanelProps {
  preparation: CameraMediaSourcePreparationResult | null
  credentials: CameraMediaSourcePreparationResult['credentials'] | null
  needsManualWifi: boolean
  manualWifiSsid: string
  manualWifiPassword: string
  wifiPasswordCopied: boolean
  onManualWifiSsidChange: (value: string) => void
  onManualWifiPasswordChange: (value: string) => void
  onCopyPassword: () => void
}

export function DjiWirelessConnectionPanel({
  preparation,
  credentials,
  needsManualWifi,
  manualWifiSsid,
  manualWifiPassword,
  wifiPasswordCopied,
  onManualWifiSsidChange,
  onManualWifiPasswordChange,
  onCopyPassword,
}: DjiWirelessConnectionPanelProps) {
  const bluetoothUnsupported = preparation?.capabilities?.bluetoothWifiCredentials === false

  return (
    <section className="device-connect-wireless-preparation" aria-label="DJI Wi-Fi 连接准备">
      <div className="device-connect-wireless-preparation-header">
        <div>
          <p className="device-connect-section-title">Wi-Fi 连接准备</p>
          <span>
            {preparation?.credentials
              ? '已通过蓝牙取得相机 Wi-Fi 信息，点击右侧连接即可继续'
              : bluetoothUnsupported
                ? '当前电脑不支持蓝牙，建议先让手机连接相机，再用手机系统的 Wi-Fi 分享功能查看或分享密码'
                : preparation
                  ? preparation.message
                  : '点击“开始连接”后会自动尝试通过蓝牙获取相机 Wi-Fi 信息'}
          </span>
        </div>
        <span className={`device-connect-wireless-state ${preparation?.credentials ? 'success' : needsManualWifi ? 'manual' : ''}`}>
          <Bluetooth size={13} />
          {preparation?.credentials ? '蓝牙已获取' : needsManualWifi ? '需要手动填写' : '自动尝试蓝牙'}
        </span>
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

      {needsManualWifi && (
        <div className="device-connect-wireless-manual">
          <div className="device-connect-wireless-manual-header">
            <p className="device-connect-section-title">手动填写 Wi-Fi</p>
            <span>填写后再次点击右侧连接按钮</span>
          </div>
          <div className="device-connect-wireless-manual-fields">
            <Input
              variant="compact"
              fullWidth
              aria-label="相机 Wi-Fi 名称"
              placeholder="相机 Wi-Fi 名称"
              value={manualWifiSsid}
              onChange={(event) => onManualWifiSsidChange(event.target.value)}
            />
            <Input
              variant="compact"
              fullWidth
              type="password"
              aria-label="相机 Wi-Fi 密码"
              placeholder="Wi-Fi 密码（无密码可留空）"
              value={manualWifiPassword}
              onChange={(event) => onManualWifiPasswordChange(event.target.value)}
            />
          </div>
          <p className="device-connect-wireless-manual-hint">
            电脑没有蓝牙时，建议先让手机连接相机；现在大多数手机都支持系统 Wi-Fi 分享功能，可用它查看或分享密码。然后在电脑系统 Wi-Fi 中连接相机热点，再填写这里。
          </p>
        </div>
      )}
    </section>
  )
}
