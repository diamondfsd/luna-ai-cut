import { FolderOpen, Play, RotateCcw, Server, Settings, Square } from 'lucide-react'

import type { AppSettings, DeviceDefinition, MockServerConfig, MockServerStatus } from '../shared/types'
import { Button, Input, Switch } from '../ui'
import '../styles/mock-server-debug.css'

interface DeveloperTabProps {
  activeDevice?: DeviceDefinition
  devices: DeviceDefinition[]
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
  developerMode: boolean
  mockServerStatuses: MockServerStatus[]
  startMockServer: (deviceId?: string, settings?: Partial<AppSettings>) => Promise<void>
  stopMockServer: (deviceId?: string) => Promise<void>
  chooseMockMediaDir: (deviceId?: string) => Promise<void>
  openDirectory: (targetPath: string | null | undefined) => void
}

function defaultConfig(device: DeviceDefinition): MockServerConfig {
  return {
    rootDir: '',
    host: device.mock.host,
    httpPort: device.mock.httpPort,
    tcpPort: device.mock.tcpPort,
    udpPort: device.mock.udpPort ?? (device.protocol === 'dji' ? 19004 : 19001),
    rateMbps: device.mock.rateMbps,
  }
}

function configFor(device: DeviceDefinition, settings: AppSettings | null): MockServerConfig {
  const configured = settings?.mockServers?.[device.id]
  const isActive = settings?.activeDeviceId === device.id
  const legacy: Partial<MockServerConfig> = isActive
    ? {
        rootDir: settings?.mockMediaDir,
        host: settings?.mockHost,
        httpPort: settings?.mockHttpPort,
        tcpPort: settings?.mockTcpPort,
        rateMbps: settings?.mockRateMbps,
      }
    : {}
  return { ...defaultConfig(device), ...legacy, ...configured }
}

function numericSetting(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function DeveloperTab({
  activeDevice,
  devices,
  settings,
  setSettings,
  developerMode,
  mockServerStatuses,
  startMockServer,
  stopMockServer,
  chooseMockMediaDir,
  openDirectory,
}: DeveloperTabProps) {
  async function toggleDeveloperMode(): Promise<void> {
    if (developerMode) {
      await stopMockServer()
      const updated = await window.luna.saveSettings({ cameraHost: activeDevice?.defaultHost ?? '192.168.42.1' })
      setSettings(updated)
      return
    }

    const updated = await window.luna.saveSettings({ developerMode: true })
    setSettings(updated)
  }

  function updateConfig(device: DeviceDefinition, patch: Partial<MockServerConfig>): void {
    setSettings((current) => {
      if (!current) return current
      const next = { ...configFor(device, current), ...patch }
      return {
        ...current,
        mockServers: { ...(current.mockServers ?? {}), [device.id]: next },
        ...(current.activeDeviceId === device.id
          ? {
              mockMediaDir: next.rootDir,
              mockHost: next.host,
              mockHttpPort: next.httpPort,
              mockTcpPort: next.tcpPort,
              mockRateMbps: next.rateMbps,
            }
          : {}),
      }
    })
  }

  async function saveConfig(device: DeviceDefinition): Promise<void> {
    const current = settings
    if (!current) return
    const config = configFor(device, current)
    const updated = await window.luna.saveSettings({
      mockServers: { ...(current.mockServers ?? {}), [device.id]: config },
      ...(current.activeDeviceId === device.id
        ? {
            mockMediaDir: config.rootDir,
            mockHost: config.host,
            mockHttpPort: config.httpPort,
            mockTcpPort: config.tcpPort,
            mockRateMbps: config.rateMbps,
          }
        : {}),
    })
    setSettings(updated)
  }

  function statusFor(deviceId: string): MockServerStatus | undefined {
    return mockServerStatuses.find((status) => status.deviceId === deviceId)
  }

  const mockDevices = devices.filter((device) => device.protocol === 'insta360' || device.protocol === 'go-ultra' || device.protocol === 'dji')

  return (
    <div className="developer-debug-content">
      <section className="ble-debug-panel developer-mode-panel">
        <h2><Settings size={17} /> 开发者模式</h2>
        <div className="developer-mode-row">
          <div>
            <div className="developer-mode-title">开发者模式</div>
            <em>开启后可以在下面分别启动各设备的模拟服务</em>
          </div>
          <div className="developer-mode-actions">
            <Button variant="ghost" size="mini" onClick={() => void window.luna.openDevTools()} style={{ borderColor: 'var(--blue)', color: 'var(--blue)', borderStyle: 'solid' }}>
              开发者工具
            </Button>
            <Switch checked={developerMode} onCheckedChange={() => void toggleDeveloperMode()} ariaLabel="开发者模式" />
          </div>
        </div>
      </section>

      <section className="mock-server-list" aria-label="模拟服务列表">
        <div className="mock-server-list-header">
          <div>
            <h2><Server size={17} /> 模拟服务</h2>
            <p>每个设备使用独立端口和素材目录，可以同时运行多个服务。</p>
          </div>
        </div>

        {mockDevices.map((device) => {
          const config = configFor(device, settings)
          const status = statusFor(device.id)
          const running = Boolean(status?.running)
          return (
            <article className={`mock-server-card${activeDevice?.id === device.id ? ' is-active' : ''}`} key={device.id}>
              <div className="mock-server-card-header">
                <div>
                  <h3>{device.name}</h3>
                  <span>{device.vendor} · {running ? '运行中' : (status?.message ?? '未启动')}</span>
                </div>
                <div className="mock-server-card-actions">
                  {running && (
                    <Button variant="secondary" size="compact" onClick={() => void stopMockServer(device.id)} icon={<Square size={15} />}>
                      停止
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="compact"
                    onClick={() => void startMockServer(device.id, settings ?? undefined)}
                    icon={running ? <RotateCcw size={15} /> : <Play size={15} />}
                  >
                    {running ? '重启' : '启动'}
                  </Button>
                </div>
              </div>

              <div className="mock-server-media-row">
                <div className="mock-server-path" title={config.rootDir || '未选择素材目录'}>{config.rootDir || '未选择素材目录'}</div>
                <div className="mock-server-path-actions">
                  <Button variant="secondary" size="compact" onClick={() => openDirectory(config.rootDir)} disabled={!config.rootDir} icon={<FolderOpen size={15} />}>
                    打开
                  </Button>
                  <Button variant="secondary" size="compact" onClick={() => void chooseMockMediaDir(device.id)} icon={<FolderOpen size={15} />}>
                    选择素材
                  </Button>
                </div>
              </div>

              <div className="mock-server-config-grid">
                <label>
                  <span>地址</span>
                  <Input variant="compact" fullWidth value={config.host} onChange={(event) => updateConfig(device, { host: event.target.value })} onBlur={() => void saveConfig(device)} />
                </label>
                <label>
                  <span>HTTP</span>
                  <Input variant="compact" fullWidth inputMode="numeric" value={config.httpPort} onChange={(event) => updateConfig(device, { httpPort: numericSetting(event.target.value, config.httpPort) })} onBlur={() => void saveConfig(device)} />
                </label>
                <label>
                  <span>控制</span>
                  <Input variant="compact" fullWidth inputMode="numeric" value={config.tcpPort} onChange={(event) => updateConfig(device, { tcpPort: numericSetting(event.target.value, config.tcpPort) })} onBlur={() => void saveConfig(device)} />
                </label>
                <label>
                  <span>UDP</span>
                  <Input variant="compact" fullWidth inputMode="numeric" value={config.udpPort} onChange={(event) => updateConfig(device, { udpPort: numericSetting(event.target.value, config.udpPort) })} onBlur={() => void saveConfig(device)} />
                </label>
                <label>
                  <span>限速 MB/s</span>
                  <Input variant="compact" fullWidth inputMode="decimal" value={config.rateMbps} onChange={(event) => updateConfig(device, { rateMbps: numericSetting(event.target.value, config.rateMbps) })} onBlur={() => void saveConfig(device)} />
                </label>
              </div>

              <div className="mock-server-endpoint">
                <span>{config.host}:{config.httpPort}</span>
                <span>控制 {config.tcpPort}</span>
                {device.protocol === 'dji' && <span>UDP {config.udpPort}</span>}
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
