import { useState } from 'react'
import { CheckCircle2, HelpCircle, MonitorCog, PlugZap, RefreshCw } from 'lucide-react'

import type { AppSettings, ConnectionStatus, DeviceConnectionPhase, DeviceDefinition } from '../shared/types'
import { Alert, Button } from '../ui'
import { HelpDialog } from '../components/HelpDialog'
import '../styles/wifi.css'
import lunaIcon from '/luna-icon.png'

interface DeviceConnectPageProps {
  activeDevice?: DeviceDefinition
  connection: ConnectionStatus | null
  phase: DeviceConnectionPhase
  settings: AppSettings | null
  onConnect: () => Promise<void>
}

export function DeviceConnectPage({
  activeDevice,
  connection,
  phase,
  settings,
  onConnect,
}: DeviceConnectPageProps) {
  const [connecting, setConnecting] = useState(false)
  const isChecking = phase === 'checking'
  const isError = phase === 'error'
  const deviceName = activeDevice?.name ?? '设备'

  async function handleConnect(): Promise<void> {
    setConnecting(true)
    try {
      await onConnect()
    } finally {
      setConnecting(false)
    }
  }

  return (
    <section className="device-connect-page">
      <div className="device-connect-content">
        <div className="device-connect-icon">
          <img src={lunaIcon} alt="Luna" className="device-connect-logo" />
        </div>

        <h1>{isChecking ? `正在连接 ${deviceName}` : isError ? `未连接 ${deviceName}` : `连接 ${deviceName}`}</h1>

        {isError && connection?.message ? (
          <Alert variant="error" message={connection.message} />
        ) : (
          <p className="device-connect-desc">
            {isChecking
              ? '正在唤醒设备、检测 Wi-Fi 服务并建立控制会话'
              : connection?.message ?? ''}
          </p>
        )}

        <div className="device-connect-meta">
          <span>
            <PlugZap size={14} />
            {settings?.cameraHost ?? activeDevice?.defaultHost ?? '未配置'}
          </span>
          {connection?.httpOk && connection.controlOk && (
            <span>
              <CheckCircle2 size={14} />
              已检测到服务
            </span>
          )}
        </div>

        <div className="device-connect-actions">
          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={connecting || isChecking}
            icon={connecting || isChecking ? <RefreshCw className="spin" size={16} /> : <RefreshCw size={16} />}
          >
            {isError ? '重新连接' : '开始连接'}
          </Button>
          <Button variant="secondary" onClick={() => window.luna.openWifiSettings()} icon={<MonitorCog size={16} />}>
            打开 Wi-Fi 设置
          </Button>
        </div>
        <p className="device-connect-tip">
          设备 Wi-Fi 可能无互联网；下载完成后建议切回自己的网络
        </p>
        <div className="device-connect-help">
          <HelpDialog>
            <button className="device-help-btn" title="帮助与反馈">
              <HelpCircle size={14} />
              帮助与反馈
            </button>
          </HelpDialog>
        </div>
      </div>
    </section>
  )
}
