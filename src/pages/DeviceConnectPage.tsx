import { useCallback, useEffect, useState } from 'react'
import { Cable, Camera, Check, CheckCircle2, Copy, FolderOpen, HardDrive, HelpCircle, Info, KeyRound, MonitorCog, RefreshCw, Wifi } from 'lucide-react'

import type { AppSettings, CameraConnectionMode, CameraMediaSourceOptions, CameraMediaSourcePreparationResult, ConnectionStatus, DeviceConnectionPhase, DeviceDefinition, MountedCameraVolume } from '../shared/types'
import { SupportedDeviceList } from '../components/SupportedDeviceList'
import { WirelessConnectionPanel } from '../components/WirelessConnectionPanel'
import { Alert, Button, ButtonGroup, Dialog, Input } from '../ui'
import { HelpDialog } from '../components/HelpDialog'
import { StorageMigrationDialog } from '../components/StorageMigrationDialog'
import { useStorageMigration } from '../hooks/useStorageMigration'
import '../styles/wifi.css'
import '../styles/device-connect-layout.css'
import '../styles/device-connect-wifi-password.css'
import lunaIcon from '../../public/luna-icon.png'
import pocket3Character from '../../public/pocket3.png'
import pocket4Character from '../../public/pocket4.png'
import pocket4ProCharacter from '../../public/pocket4p-white.png'

function deviceConnectVisual(device?: DeviceDefinition) {
  if (device?.protocol === 'insta360') {
    return <img src={lunaIcon} alt="" className="device-connect-logo" />
  }
  if (device?.id === 'dji-pocket-4') {
    return <img src={pocket4Character} alt="" className="device-connect-logo device-connect-logo-character" />
  }
  if (device?.id === 'dji-pocket-3') {
    return <img src={pocket3Character} alt="" className="device-connect-logo device-connect-logo-character" />
  }
  if (device?.id === 'dji-pocket-4-pro') {
    return <img src={pocket4ProCharacter} alt="" className="device-connect-logo device-connect-logo-character" />
  }
  return (
    <span className="device-connect-logo device-connect-logo-fallback" aria-hidden="true">
      <Camera size={30} strokeWidth={1.6} />
    </span>
  )
}

interface DeviceConnectPageProps {
  activeDevice?: DeviceDefinition
  devices: DeviceDefinition[]
  connection: ConnectionStatus | null
  phase: DeviceConnectionPhase
  settings: AppSettings | null
  onConnect: (rootPath?: string, deviceId?: string, wireless?: CameraMediaSourceOptions['wireless']) => Promise<void>
  onPrepareConnection: (preferExistingConnection?: boolean) => Promise<CameraMediaSourcePreparationResult | null>
  preparedWifi: CameraMediaSourcePreparationResult['credentials'] | null
  onDeviceChange: (deviceId: string) => Promise<void>
  connectionMode: CameraConnectionMode
  onConnectionModeChange: (mode: CameraConnectionMode) => Promise<void>
  onChooseWiredCamera: () => Promise<void>
  onStorageMigrated: (settings: AppSettings) => void
}

export function DeviceConnectPage({
  activeDevice,
  devices,
  connection,
  phase,
  settings,
  onConnect,
  onPrepareConnection,
  preparedWifi,
  onDeviceChange,
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
  const [changingDevice, setChangingDevice] = useState(false)
  const [wifiPasswordCopied, setWifiPasswordCopied] = useState(false)
  const [wifiPasswordDialogOpen, setWifiPasswordDialogOpen] = useState(false)
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')
  const [wifiPasswordError, setWifiPasswordError] = useState<string | null>(null)
  const [wifiPasswordConnecting, setWifiPasswordConnecting] = useState(false)
  const [wirelessPreparation, setWirelessPreparation] = useState<CameraMediaSourcePreparationResult | null>(null)
  const { migrating, migrationResult, restarting, migrate, restart } = useStorageMigration(settings, onStorageMigrated)
  const isChecking = phase === 'checking'
  const isError = phase === 'error'
  const deviceName = activeDevice?.name ?? '设备'
  const isWired = connectionMode === 'wired'
  const isBluetoothWifiWireless = !isWired && (activeDevice?.protocol === 'dji' || activeDevice?.id === 'luna-ultra')
  const canAutoJoinWifi = !isWired && activeDevice?.wifi?.autoJoin === true
  const wifiCredentials = preparedWifi ?? wirelessPreparation?.credentials ?? null
  const needsSystemWifi = isBluetoothWifiWireless && Boolean(wirelessPreparation && !wifiCredentials)
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
      : canAutoJoinWifi
        ? '开始连接时会先检测设备 Wi-Fi；如果连接失败，会提示输入 Wi-Fi 密码后重试'
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

  useEffect(() => {
    setWirelessPreparation(null)
  }, [activeDevice?.id, connectionMode])

  useEffect(() => {
    if (!connection || isWired) {
      setWifiPasswordDialogOpen(false)
      setWifiSsid('')
      setWifiPasswordError(null)
      setWifiPassword('')
      return
    }
    if (connection?.httpOk && connection.controlOk) {
      setWifiPasswordDialogOpen(false)
      setWifiSsid('')
      setWifiPasswordError(null)
      setWifiPassword('')
      return
    }
    if (connection?.wifiPasswordRequired && !wifiPasswordConnecting) {
      setWifiPasswordDialogOpen(true)
      setWifiSsid(connection.wifiSsid ?? '')
      setWifiPasswordError(connection.message.startsWith('请输入 ') ? null : connection.message)
    }
  }, [connection, isWired, wifiPasswordConnecting])

  function closeWifiPasswordDialog(): void {
    if (wifiPasswordConnecting) return
    setWifiPasswordDialogOpen(false)
    setWifiSsid('')
    setWifiPasswordError(null)
    setWifiPassword('')
  }

  async function handleConnect(): Promise<void> {
    setConnecting(true)
    try {
      let preparation = wirelessPreparation
      let credentials = wifiCredentials
      if (isBluetoothWifiWireless && !credentials && (!preparation || (preparation.preparation === 'already-connected' && !preparation.requiresManualWifi))) {
        const result = await onPrepareConnection(true)
        setWirelessPreparation(result)
        preparation = result
        credentials = result?.credentials ?? null
        if (result?.requiresManualWifi) return
      }
      const wireless = isBluetoothWifiWireless
        ? credentials
          ? {
              preparation: 'bluetooth' as const,
              ssid: credentials.ssid,
              password: credentials.password,
              autoJoin: true,
            }
          : preparation
            ? { preparation: 'already-connected' as const }
            : undefined
        : undefined
      await onConnect(undefined, undefined, wireless)
    } finally {
      setConnecting(false)
    }
  }

  async function handleReadWirelessWifi(): Promise<void> {
    if (!isBluetoothWifiWireless || connecting || isChecking) return
    setConnecting(true)
    try {
      const result = await onPrepareConnection()
      setWirelessPreparation(result)
    } finally {
      setConnecting(false)
    }
  }

  async function handleWifiPasswordConnect(): Promise<void> {
    const ssid = wifiSsid.trim()
    if (!ssid || !wifiPassword) {
      setWifiPasswordError(!ssid ? '请输入 Wi-Fi 名称' : '请输入 Wi-Fi 密码')
      return
    }
    setWifiPasswordError(null)
    setWifiPasswordConnecting(true)
    try {
      await onConnect(undefined, undefined, {
        preparation: 'manual-wifi',
        ssid,
        password: wifiPassword,
        autoJoin: true,
      })
    } finally {
      setWifiPasswordConnecting(false)
      setWifiPassword('')
    }
  }

  async function copyWifiPassword(): Promise<void> {
    if (!wifiCredentials?.password) return
    try {
      await navigator.clipboard.writeText(wifiCredentials.password)
      setWifiPasswordCopied(true)
      window.setTimeout(() => setWifiPasswordCopied(false), 1500)
    } catch {
      setWifiPasswordCopied(false)
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

  async function handleSupportedDeviceSelect(deviceId: string): Promise<void> {
    if (isChecking || changingDevice) return
    setChangingDevice(true)
    try {
      await onDeviceChange(deviceId)
    } finally {
      setChangingDevice(false)
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
      <div className="device-connect-layout">
        <aside className="device-connect-sidebar">
          <SupportedDeviceList
            activeDevice={activeDevice}
            devices={devices}
            disabled={connecting || changingDevice || isChecking}
            onSelect={handleSupportedDeviceSelect}
          />
          <div className="device-connect-sidebar-footer">
            <HelpDialog>
              <Button variant="ghost" size="mini" icon={<HelpCircle size={14} />}>
                帮助与反馈
              </Button>
            </HelpDialog>
          </div>
        </aside>

        <main className="device-connect-main">
          <header className="device-connect-header">
            <div className="device-connect-brand">
              {deviceConnectVisual(activeDevice)}
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

            {isError && !isWired && connection?.wifiPasswordRequired && !wifiPasswordDialogOpen && (
              <Button
                variant="secondary"
                size="compact"
                onClick={() => setWifiPasswordDialogOpen(true)}
                icon={<KeyRound size={15} />}
              >
                输入 Wi-Fi 密码
              </Button>
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

            {isBluetoothWifiWireless && (
              <WirelessConnectionPanel
                deviceName={deviceName}
                preparation={wirelessPreparation}
                credentials={wifiCredentials}
                needsSystemWifi={needsSystemWifi}
                wifiPasswordCopied={wifiPasswordCopied}
                onCopyPassword={() => void copyWifiPassword()}
                loading={connecting || isChecking}
                onReadWifi={() => void handleReadWirelessWifi()}
              />
            )}

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
            <span>当前设备：{deviceName}</span>
          </div>
        </main>
      </div>
      <StorageMigrationDialog
        migrating={migrating}
        result={migrationResult}
        restarting={restarting}
        onRestart={() => void restart()}
      />
      <Dialog
        open={wifiPasswordDialogOpen}
        onOpenChange={(open) => {
          if (open) setWifiPasswordDialogOpen(true)
          else closeWifiPasswordDialog()
        }}
        title={`输入 ${deviceName} 的 Wi-Fi 密码`}
        description="如果列表中没有找到热点，请手动填写 Wi-Fi 名称和密码。"
        className="device-connect-wifi-password-dialog"
        closeOnMaskClick={!wifiPasswordConnecting}
        footer={(
          <>
            <Button variant="secondary" disabled={wifiPasswordConnecting} onClick={closeWifiPasswordDialog}>取消</Button>
            <Button
              variant="primary"
              disabled={wifiPasswordConnecting || !wifiSsid.trim() || !wifiPassword}
              onClick={() => void handleWifiPasswordConnect()}
              icon={<KeyRound size={16} />}
            >
              {wifiPasswordConnecting ? '正在连接' : '连接'}
            </Button>
          </>
        )}
      >
        <div className="device-connect-wifi-password-body">
          <label className="device-connect-wifi-password-field">
            <span>Wi-Fi 名称</span>
            <Input
              variant="pill"
              value={wifiSsid}
              onChange={(event) => setWifiSsid(event.target.value)}
              placeholder="例如 Luna Ultra 9P4FM5.OSC"
              autoFocus={!wifiSsid}
              fullWidth
            />
          </label>
          <label className="device-connect-wifi-password-field">
            <span>Wi-Fi 密码</span>
            <Input
              variant="pill"
              type="password"
              value={wifiPassword}
              onChange={(event) => setWifiPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && wifiPassword) void handleWifiPasswordConnect()
              }}
              placeholder="输入密码"
              autoFocus={Boolean(wifiSsid)}
              fullWidth
            />
          </label>
          {wifiPasswordError && <Alert variant="error" message={wifiPasswordError} />}
          <p>应用不会读取系统中已保存的 Wi-Fi 密码。</p>
        </div>
      </Dialog>
    </section>
  )
}
