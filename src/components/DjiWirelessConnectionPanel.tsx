import { Bluetooth, Check, Copy } from 'lucide-react'

import type { CameraMediaSourcePreparationResult } from '../shared/types'
import { Button } from '../ui'
import '../styles/device-connect-wireless.css'

interface DjiWirelessConnectionPanelProps {
  preparation: CameraMediaSourcePreparationResult | null
  credentials: CameraMediaSourcePreparationResult['credentials'] | null
  needsSystemWifi: boolean
  wifiPasswordCopied: boolean
  onCopyPassword: () => void
}

export function DjiWirelessConnectionPanel({
  preparation,
  credentials,
  needsSystemWifi,
  wifiPasswordCopied,
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
              ? '已通过蓝牙取得相机 Wi-Fi 信息，请使用系统 Wi-Fi 工具连接相机后点击右侧连接'
              : bluetoothUnsupported
                ? '当前电脑不支持蓝牙，请使用系统 Wi-Fi 工具手动连接相机热点'
                : preparation
                  ? preparation.message
                  : '点击“开始连接”后会自动尝试通过蓝牙获取相机 Wi-Fi 信息'}
          </span>
        </div>
        <span className={`device-connect-wireless-state ${preparation?.credentials ? 'success' : needsSystemWifi ? 'system' : ''}`}>
          <Bluetooth size={13} />
          {preparation?.credentials ? '蓝牙已获取' : needsSystemWifi ? '需要系统 Wi-Fi' : '自动尝试蓝牙'}
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

      {needsSystemWifi && (
        <div className="device-connect-wireless-system">
          <p className="device-connect-section-title">请使用系统 Wi-Fi 连接工具</p>
          <p>
            点击右侧“打开 Wi-Fi 设置”，在系统中手动连接相机热点。电脑没有蓝牙时，可先让手机连接相机；现在大多数手机都支持系统 Wi-Fi 分享功能，可以用手机获取密码。连接完成后回来点击“开始连接”，应用不会自动切换系统网络。
          </p>
        </div>
      )}
    </section>
  )
}
