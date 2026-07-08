import { useState } from 'react'
import { Check, CheckCircle2, Copy, HelpCircle, MonitorCog, PlugZap, RefreshCw } from 'lucide-react'

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
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)
  const isChecking = phase === 'checking'
  const isError = phase === 'error'
  const deviceName = activeDevice?.name ?? '设备'
  const deviceInfo = connection?.deviceInfo
  const infoRows = [
    ['设备', deviceInfo?.deviceName],
    ['序列号', deviceInfo?.serial],
    ['固件', deviceInfo?.firmware],
    ['Wi-Fi', deviceInfo?.ssid],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  async function handleConnect(): Promise<void> {
    setConnecting(true)
    try {
      await onConnect()
    } finally {
      setConnecting(false)
    }
  }

  async function handleCopyDiagnostics(): Promise<void> {
    const text = connection?.diagnosticsRaw
    if (!text) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setDiagnosticsCopied(true)
      window.setTimeout(() => setDiagnosticsCopied(false), 1500)
    } catch {
      setDiagnosticsCopied(false)
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
              ? '正在 检测 Wi-Fi 服务并建立控制会话'
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

        {infoRows.length > 0 && (
          <dl className="device-info-grid">
            {infoRows.map(([label, value]) => (
              <div key={label} className="device-info-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {isError && connection?.diagnosticsRaw && (
          <div className="device-connect-diagnostics">
            <div className="device-connect-diagnostics-header">
              <p className="device-connect-section-title">原始诊断信息</p>
              <Button
                variant="secondary"
                size="mini"
                onClick={handleCopyDiagnostics}
                icon={diagnosticsCopied ? <Check size={13} /> : <Copy size={13} />}
              >
                {diagnosticsCopied ? '已复制' : '复制'}
              </Button>
            </div>
            <pre className="device-connect-diagnostics-raw">{connection.diagnosticsRaw}</pre>
          </div>
        )}

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
