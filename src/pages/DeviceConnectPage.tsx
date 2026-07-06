import { useEffect, useState } from 'react'
import { Cable, Check, CheckCircle2, Copy, HelpCircle, MonitorCog, PlugZap, RefreshCw } from 'lucide-react'

import type { AppSettings, ConnectionMode, ConnectionStatus, DeviceConnectionPhase, DeviceDefinition, UsbDeviceCandidate } from '../shared/types'
import { Alert, Button, SegmentedControl } from '../ui'
import { HelpDialog } from '../components/HelpDialog'
import '../styles/wifi.css'
import lunaIcon from '/luna-icon.png'

interface DeviceConnectPageProps {
  activeDevice?: DeviceDefinition
  connection: ConnectionStatus | null
  phase: DeviceConnectionPhase
  settings: AppSettings | null
  onConnect: (mode?: ConnectionMode) => Promise<void>
}

export function DeviceConnectPage({
  activeDevice,
  connection,
  phase,
  settings,
  onConnect,
}: DeviceConnectPageProps) {
  const [connecting, setConnecting] = useState(false)
  const [usbScanning, setUsbScanning] = useState(false)
  const [usbDevices, setUsbDevices] = useState<UsbDeviceCandidate[]>([])
  const [usbMessage, setUsbMessage] = useState('正在检测数据线连接...')
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>(settings?.connectionMode ?? 'wifi')
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)
  const connectionMode = selectedMode
  const isChecking = phase === 'checking'
  const isError = phase === 'error'
  const deviceName = activeDevice?.name ?? '设备'
  const displayHost = settings?.cameraHost || activeDevice?.defaultHost || '未配置'
  const deviceInfo = connection?.deviceInfo
  const infoRows = [
    ['设备', deviceInfo?.deviceName],
    ['序列号', deviceInfo?.serial],
    ['固件', deviceInfo?.firmware],
    ['Wi-Fi', deviceInfo?.ssid],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  useEffect(() => {
    setSelectedMode(settings?.connectionMode ?? 'wifi')
  }, [settings?.connectionMode])

  useEffect(() => {
    void scanUsb()
  }, [])

  async function scanUsb(): Promise<void> {
    setUsbScanning(true)
    try {
      const devices = await window.luna.scanUsbDevices()
      setUsbDevices(devices)
      setUsbMessage(devices.length > 0 ? '已识别到数据线存储或设备' : '暂未识别到数据线存储')
    } catch {
      setUsbDevices([])
      setUsbMessage('暂未识别到数据线存储')
    } finally {
      setUsbScanning(false)
    }
  }

  async function handleConnect(): Promise<void> {
    setConnecting(true)
    try {
      await onConnect(connectionMode)
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
              ? connectionMode === 'usb' ? '正在检测本地 USB 存储' : '正在检测 Wi-Fi 服务并建立控制会话'
              : connection?.message ?? ''}
          </p>
        )}

        <div className="device-connect-meta">
          <span>
            <PlugZap size={14} />
            {connectionMode === 'usb' ? '本地 USB' : displayHost}
          </span>
          {connection?.httpOk && connection.controlOk && (
            <span>
              <CheckCircle2 size={14} />
              已检测到服务
            </span>
          )}
          {connection?.usbOk && (
            <span>
              <CheckCircle2 size={14} />
              已检测到 {connection.usbStorageCount ?? 0} 个数据线存储
            </span>
          )}
        </div>

        <div className="device-connect-mode">
          <SegmentedControl<ConnectionMode>
            ariaLabel="选择连接方式"
            options={[
              { value: 'wifi', label: 'Wi-Fi' },
              { value: 'usb', label: '本地 USB' },
            ]}
            value={connectionMode}
            onChange={(value) => {
              setSelectedMode(value)
              void window.luna.saveSettings({ connectionMode: value }).then(() => {
                if (value === 'usb') void scanUsb()
              })
            }}
          />
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
            {isError ? '重新连接' : connectionMode === 'usb' ? '连接本地 USB' : '连接 Wi-Fi'}
          </Button>
          {connectionMode === 'wifi' && (
            <Button variant="secondary" onClick={() => window.luna.openWifiSettings()} icon={<MonitorCog size={16} />}>
              打开 Wi-Fi 设置
            </Button>
          )}
        </div>

        <div className="device-usb-panel">
          <div className="device-usb-heading">
            <span>
              <Cable size={15} />
              数据线连接
            </span>
            <button type="button" onClick={() => void scanUsb()} disabled={usbScanning}>
              <RefreshCw size={13} className={usbScanning ? 'spin' : undefined} />
              刷新
            </button>
          </div>
          {usbDevices.length > 0 ? (
            <div className="device-usb-list">
              {usbDevices.map((device) => (
                <div className="device-usb-item" key={device.id}>
                  <strong>{device.name}</strong>
                  <span>
                    {[
                      device.manufacturer || '未知厂商',
                      device.mountPath,
                      device.busName,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  {(device.vendorId || device.productId || device.serialNumber) && (
                    <em>
                      {[device.vendorId, device.productId, device.serialNumber].filter(Boolean).join(' · ')}
                    </em>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="device-usb-empty">{usbMessage}</p>
          )}
          <p className="device-usb-note">
            Windows 文件传输模式会动态识别相机挂载出的内部存储和 SD 卡，不依赖固定盘符。
          </p>
        </div>
        <p className="device-connect-tip">
          {connectionMode === 'usb'
            ? '本地 USB 模式会直接读取 Windows 里出现的相机存储'
            : '设备 Wi-Fi 可能无互联网；下载完成后建议切回自己的网络'}
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
