import { useCallback, useEffect, useState } from 'react'
import { Cable, Check, CheckCircle2, Copy, FolderOpen, HardDrive, HelpCircle, Info, MonitorCog, RefreshCw, Wifi } from 'lucide-react'

import type { AppSettings, CameraConnectionMode, ConnectionStatus, DeviceConnectionPhase, DeviceDefinition, MountedCameraVolume } from '../shared/types'
import { Alert, Button, ButtonGroup } from '../ui'
import { HelpDialog } from '../components/HelpDialog'
import { useStorageMigration } from '../hooks/useStorageMigration'
import '../styles/wifi.css'
import lunaIcon from '../../public/luna-icon.png'

interface DeviceConnectPageProps {
  activeDevice?: DeviceDefinition
  connection: ConnectionStatus | null
  phase: DeviceConnectionPhase
  settings: AppSettings | null
  onConnect: (rootPath?: string) => Promise<void>
  connectionMode: CameraConnectionMode
  onConnectionModeChange: (mode: CameraConnectionMode) => Promise<void>
  onChooseWiredCamera: () => Promise<void>
  onStorageMigrated: (settings: AppSettings) => void
}

export function DeviceConnectPage({
  activeDevice,
  connection,
  phase,
  settings,
  onConnect,
  connectionMode,
  onConnectionModeChange,
  onChooseWiredCamera,
  onStorageMigrated,
}: DeviceConnectPageProps) {
  const [connecting, setConnecting] = useState(false)
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false)
  const [diagnosticsResult, setDiagnosticsResult] = useState<string | null>(null)
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string | null>(null)
  const [mountedVolumes, setMountedVolumes] = useState<MountedCameraVolume[]>([])
  const [mountedVolumesLoading, setMountedVolumesLoading] = useState(false)
  const [mountedVolumesError, setMountedVolumesError] = useState<string | null>(null)
  const { migrating, migrate } = useStorageMigration(settings, onStorageMigrated)
  const isChecking = phase === 'checking'
  const isError = phase === 'error'
  const deviceName = activeDevice?.name ?? '设备'
  const isWired = connectionMode === 'wired'
  const deviceInfo = connection?.deviceInfo
  const deviceRows = [
    ['设备', deviceInfo?.deviceName],
    ['序列号', deviceInfo?.serial],
    ['固件', deviceInfo?.firmware],
    ['Wi-Fi', deviceInfo?.ssid],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  const connectionRows: Array<[string, string]> = isWired
    ? [
        ['连接方式', 'USB 数据线'],
        ['相机磁盘', settings?.mountedCameraRoot || '未选择'],
        ['相机端模式', '磁盘或 U 盘'],
      ]
    : [
        ['连接方式', '相机 Wi-Fi'],
        ['相机地址', settings?.cameraHost ?? activeDevice?.defaultHost ?? '未配置'],
        ...deviceRows,
      ]
  const modeLabel = isWired ? '有线连接' : '无线连接'
  const statusTitle = isChecking
    ? isWired ? '正在查找相机磁盘' : '正在建立相机会话'
    : isError ? `${deviceName} 连接失败` : `准备连接 ${deviceName}`
  const statusDescription = isChecking
    ? isWired ? '正在检查已选择的相机磁盘和素材目录' : '正在检测相机服务并建立控制会话'
    : connection?.message ?? (isWired
      ? '请选择相机磁盘后连接，即可浏览其中的相机素材'
      : '连接相机 Wi-Fi 后，即可浏览和下载相机素材')
  const statusLabel = isChecking ? '检测中' : isError ? '需要处理' : '等待连接'

  const refreshMountedVolumes = useCallback(async (): Promise<void> => {
    if (!isWired) {
      setMountedVolumes([])
      setMountedVolumesError(null)
      return
    }
    setMountedVolumesLoading(true)
    setMountedVolumesError(null)
    try {
      setMountedVolumes(await window.luna.cameraSource.detectMounted())
    } catch (error) {
      setMountedVolumes([])
      setMountedVolumesError(error instanceof Error ? error.message : '无法读取已连接的相机磁盘')
    } finally {
      setMountedVolumesLoading(false)
    }
  }, [isWired])

  useEffect(() => {
    void refreshMountedVolumes()
  }, [refreshMountedVolumes])

  async function handleConnect(): Promise<void> {
    setConnecting(true)
    try {
      await onConnect()
    } finally {
      setConnecting(false)
    }
  }

  async function handleChooseWiredCamera(): Promise<void> {
    await onChooseWiredCamera()
    await refreshMountedVolumes()
  }

  async function handleConnectMountedVolume(volume: MountedCameraVolume): Promise<void> {
    setConnecting(true)
    try {
      await onConnect(volume.rootPath)
    } finally {
      setConnecting(false)
      await refreshMountedVolumes()
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
        <header className="device-connect-header">
          <div className="device-connect-brand">
            <img src={lunaIcon} alt="Luna" className="device-connect-logo" />
            <div>
              <p>相机媒体库</p>
              <h1>连接 {deviceName}</h1>
              <span>选择本次访问相机素材的连接方式</span>
            </div>
          </div>
          <div className="device-connect-mode-picker">
            <span>连接方式</span>
            <ButtonGroup
              ariaLabel="相机连接方式"
              className="device-connect-mode"
              value={connectionMode}
              options={[
                { value: 'wireless', label: <><Wifi size={14} />无线</> },
                { value: 'wired', label: <><Cable size={14} />有线</> },
              ]}
              onChange={(mode) => void onConnectionModeChange(mode)}
            />
          </div>
        </header>

        <div className="device-connect-workspace">
          <div className="device-connect-primary">
            <div className="device-connect-status-header">
              <span className="device-connect-mode-icon">
                {isWired ? <Cable size={22} /> : <Wifi size={22} />}
              </span>
              <div>
                <p>{modeLabel}</p>
                <h2>{statusTitle}</h2>
              </div>
              <span className={`device-connect-status ${isChecking ? 'checking' : isError ? 'error' : ''}`}>
                {statusLabel}
              </span>
            </div>

            {isError && connection?.message ? (
              <Alert variant="error" message={connection.message} />
            ) : (
              <p className="device-connect-desc">{statusDescription}</p>
            )}

            <div className="device-connect-actions">
              <Button
                variant="primary"
                onClick={handleConnect}
                disabled={connecting || isChecking || (isWired && !settings?.mountedCameraRoot)}
                icon={connecting || isChecking ? <RefreshCw className="spin" size={16} /> : isWired ? <Cable size={16} /> : <Wifi size={16} />}
              >
                {isWired ? '检测并连接' : isError ? '重新连接' : '开始连接'}
              </Button>
              {isWired ? (
                <Button variant="secondary" onClick={() => void handleChooseWiredCamera()} icon={<FolderOpen size={16} />}>
                  选择相机磁盘
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => window.luna.openWifiSettings()} icon={<MonitorCog size={16} />}>
                  打开 Wi-Fi 设置
                </Button>
              )}
            </div>

            <p className="device-connect-tip">
              <Info size={14} />
              <span>{isWired
                ? '请在相机上选择磁盘或 U 盘模式；删除相机素材前会再次确认'
                : '相机 Wi-Fi 可能无法访问互联网，素材导入后可切回常用网络'}</span>
            </p>

            {isWired && (
              <section className="device-connect-volumes" aria-label="已连接的相机磁盘">
                <div className="device-connect-volumes-header">
                  <div>
                    <p className="device-connect-section-title">已检测到的相机磁盘</p>
                    <span>选择一个磁盘后只访问其中的相机素材</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="mini"
                    disabled={mountedVolumesLoading || isChecking || connecting}
                    onClick={() => void refreshMountedVolumes()}
                    icon={<RefreshCw className={mountedVolumesLoading ? 'spin' : ''} size={13} />}
                  >
                    刷新
                  </Button>
                </div>
                {mountedVolumesError && <Alert variant="error" message={mountedVolumesError} />}
                {!mountedVolumesError && mountedVolumes.length === 0 && !mountedVolumesLoading && (
                  <p className="device-connect-volumes-empty">还没有发现可读取的相机磁盘。请确认相机已选择磁盘或 U 盘模式，然后刷新。</p>
                )}
                {mountedVolumes.length > 0 && (
                  <div className="device-connect-volume-list">
                    {mountedVolumes.map((volume) => {
                      const selected = settings?.mountedCameraRoot === volume.rootPath
                      return (
                        <Button
                          key={volume.id}
                          variant={selected ? 'primary' : 'secondary'}
                          size="compact"
                          className="device-connect-volume"
                          disabled={connecting || isChecking}
                          onClick={() => void handleConnectMountedVolume(volume)}
                          icon={<HardDrive size={15} />}
                        >
                          <span>{volume.label} · {volume.mediaCount} 个素材</span>
                          <small title={volume.rootPath}>{volume.rootPath}</small>
                        </Button>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {isError && !isWired && (
              <div className="device-connect-diagnostics">
                <div className="device-connect-diagnostics-header">
                  <div>
                    <p className="device-connect-section-title">连接诊断</p>
                    <span>检测网络状态并生成反馈信息</span>
                  </div>
                  <div className="device-connect-diagnostics-actions">
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
                  诊断信息只会复制到剪贴板，不会自动上传。
                </p>
                {diagnosticsNotice && <Alert variant="info" message={diagnosticsNotice} />}
                {(diagnosticsResult ?? connection?.diagnosticsRaw) && (
                  <pre className="device-connect-diagnostics-raw">{diagnosticsResult ?? connection?.diagnosticsRaw}</pre>
                )}
              </div>
            )}
          </div>

          <aside className="device-connect-details">
            <div className="device-connect-details-header">
              <div>
                <p>当前连接</p>
                <h2>{modeLabel}</h2>
              </div>
              {connection?.httpOk && connection.controlOk && (
                <span className="device-connect-ready"><CheckCircle2 size={14} />服务可用</span>
              )}
            </div>
            <dl className="device-info-grid">
              {connectionRows.map(([label, value]) => (
                <div key={label} className="device-info-row">
                  <dt>{label}</dt>
                  <dd title={value}>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="device-connect-storage">
              <div>
                <p>本地存储</p>
                <strong title={settings?.baseDir}>{settings?.baseDir || '正在读取'}</strong>
              </div>
              <Button variant="secondary" size="mini" disabled={migrating} icon={<HardDrive size={13} />} onClick={() => void migrate()}>
                {migrating ? '迁移中' : '迁移'}
              </Button>
            </div>
          </aside>
        </div>

        <div className="device-connect-footer">
          <HelpDialog>
            <Button variant="ghost" size="mini" icon={<HelpCircle size={14} />}>
              帮助与反馈
            </Button>
          </HelpDialog>
        </div>
      </div>
    </section>
  )
}
