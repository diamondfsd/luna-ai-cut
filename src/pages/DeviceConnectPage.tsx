import { useState } from 'react'
import { Check, CheckCircle2, Copy, HelpCircle, MonitorCog, PlugZap, RefreshCw } from 'lucide-react'

import type { AppSettings, ConnectionStatus, DeviceConnectionPhase, DeviceDefinition } from '../shared/types'
import { Alert, Button } from '../ui'
import { HelpDialog } from '../components/HelpDialog'
import '../styles/wifi.css'
import lunaIcon from '../../public/luna-icon.png'

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
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false)
  const [diagnosticsResult, setDiagnosticsResult] = useState<string | null>(null)
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string | null>(null)
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

  async function copyDiagnostics(text: string): Promise<boolean> {
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
      return true
    } catch {
      setDiagnosticsCopied(false)
      return false
    }
  }

  async function handleCopyDiagnostics(): Promise<void> {
    const text = diagnosticsResult ?? connection?.diagnosticsRaw
    if (!text) return
    const copied = await copyDiagnostics(text)
    setDiagnosticsNotice(copied ? '诊断信息已复制，请粘贴发送给开发者。' : '自动复制失败，请点击“复制反馈信息”后发送给开发者。')
  }

  async function handleRunDiagnostics(): Promise<void> {
    if (diagnosticsRunning) return
    setDiagnosticsRunning(true)
    setDiagnosticsResult(null)
    setDiagnosticsNotice(null)
    try {
      const host = settings?.cameraHost ?? activeDevice?.defaultHost
      const result = await window.luna.collectNetworkDiagnostics(host)
      const report = JSON.stringify(result, null, 2)
      setDiagnosticsResult(report)
      const copied = await copyDiagnostics(report)
      setDiagnosticsNotice(copied ? '诊断完成，信息已自动复制，请粘贴发送给开发者。' : '诊断完成，但自动复制失败，请点击“复制反馈信息”后发送给开发者。')
    } catch (error) {
      const report = JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        host: settings?.cameraHost ?? activeDevice?.defaultHost ?? null,
      }, null, 2)
      setDiagnosticsResult(report)
      const copied = await copyDiagnostics(report)
      setDiagnosticsNotice(copied ? '诊断完成，信息已自动复制，请粘贴发送给开发者。' : '诊断完成，但自动复制失败，请点击“复制反馈信息”后发送给开发者。')
    } finally {
      setDiagnosticsRunning(false)
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

        {isError && (
          <div className="device-connect-diagnostics">
            <div className="device-connect-diagnostics-header">
              <p className="device-connect-section-title">连接诊断</p>
              <div>
                <Button
                  variant="primary"
                  size="mini"
                  onClick={handleRunDiagnostics}
                  disabled={diagnosticsRunning}
                  icon={<RefreshCw className={diagnosticsRunning ? 'spin' : ''} size={13} />}
                >
                  {diagnosticsRunning ? '检测中' : '一键检测'}
                </Button>
              <Button
                variant="secondary"
                size="mini"
                onClick={handleCopyDiagnostics}
                disabled={!diagnosticsResult && !connection?.diagnosticsRaw}
                icon={diagnosticsCopied ? <Check size={13} /> : <Copy size={13} />}
              >
                {diagnosticsCopied ? '已复制' : '复制反馈信息'}
              </Button>
              </div>
            </div>
            <p className="device-connect-diagnostics-hint">
              请先连接相机 Wi-Fi，再点击检测。完成后复制反馈信息发给我们，报告不会自动上传。
            </p>
            {diagnosticsNotice && <Alert variant="info" message={diagnosticsNotice} />}
            {(diagnosticsResult ?? connection?.diagnosticsRaw) && (
              <pre className="device-connect-diagnostics-raw">{diagnosticsResult ?? connection?.diagnosticsRaw}</pre>
            )}
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
