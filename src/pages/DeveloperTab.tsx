import { FolderOpen, Play, RotateCcw, Settings, Square } from 'lucide-react'

import type { AppSettings, DeviceDefinition, MockServerStatus } from '../shared/types'
import { Button, Input, Switch } from '../ui'

interface DeveloperTabProps {
  activeDevice?: DeviceDefinition
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
  developerMode: boolean
  mockServerStatus: MockServerStatus | null
  startMockServer: (settings?: Partial<AppSettings>) => Promise<void>
  stopMockServer: () => Promise<void>
  chooseMockMediaDir: () => Promise<void>
  openDirectory: (targetPath: string | null | undefined) => void
}

function numericSetting(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function DeveloperTab({
  activeDevice,
  settings,
  setSettings,
  developerMode,
  mockServerStatus,
  startMockServer,
  stopMockServer,
  chooseMockMediaDir,
  openDirectory,
}: DeveloperTabProps) {
  const mockDefaults = activeDevice?.mock
  const mockHost = settings?.mockHost ?? mockDefaults?.host ?? ''
  const mockHttpPort = settings?.mockHttpPort ?? mockDefaults?.httpPort ?? 0
  const mockTcpPort = settings?.mockTcpPort ?? mockDefaults?.tcpPort ?? 0
  const mockRateMbps = settings?.mockRateMbps ?? mockDefaults?.rateMbps ?? 0

  async function toggleDeveloperMode(): Promise<void> {
    if (developerMode) {
      await stopMockServer()
      const updated = await window.luna.saveSettings({ cameraHost: activeDevice?.defaultHost ?? '192.168.42.1' })
      setSettings(updated)
      return
    }

    const updated = await window.luna.saveSettings({ developerMode: true })
    setSettings(updated)
    await startMockServer(updated)
  }

  async function savePartial(partial: Partial<AppSettings>): Promise<AppSettings> {
    const updated = await window.luna.saveSettings(partial)
    setSettings(updated)
    return updated
  }

  return (
    <div className="ble-debug-grid developer-debug-grid">
      <section className="ble-debug-panel">
        <h2><Settings size={17} /> 开发者模式</h2>
        <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 12px' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>开发者模式</div>
            <em style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'normal' }}>开启后使用当前设备的模拟服务进行测试</em>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="ghost" size="mini" onClick={() => void window.luna.openDevTools()} style={{ borderColor: 'var(--blue)', color: 'var(--blue)', borderStyle: 'solid' }}>
              开发者工具
            </Button>
            <Switch checked={developerMode} onCheckedChange={() => void toggleDeveloperMode()} ariaLabel="开发者模式" />
          </div>
        </div>
      </section>

      {developerMode && (
        <>
          <section className="ble-debug-panel">
            <h2>Mock Server</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0 12px' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{mockServerStatus?.cameraHost ?? `${mockHost}:${mockHttpPort}`}</div>
                <em style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'normal' }}>{mockServerStatus?.message ?? '未启动'}</em>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" size="compact" onClick={() => void stopMockServer()} icon={<Square size={15} />}>
                  停止
                </Button>
                <Button
                  variant="primary"
                  size="compact"
                  onClick={() => void startMockServer(settings ?? undefined)}
                  icon={mockServerStatus?.running ? <RotateCcw size={15} /> : <Play size={15} />}
                >
                  {mockServerStatus?.running ? '重启' : '启动'}
                </Button>
              </div>
            </div>
          </section>

          <section className="ble-debug-panel">
            <h2>Mock 配置</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>素材目录</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.mockMediaDir)} icon={<FolderOpen size={15} />}>
                    打开
                  </Button>
                  <Button variant="secondary" size="compact" onClick={chooseMockMediaDir} icon={<FolderOpen size={15} />}>
                    选择
                  </Button>
                </div>
              </div>
              <div style={{ fontWeight: 500, color: 'var(--muted)' }}>{settings?.mockMediaDir || '未选择'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <label>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 13 }}>链接地址</span>
                  <Input
                    variant="compact"
                    fullWidth
                    value={mockHost}
                    onChange={(event) => setSettings((current) => (current ? { ...current, mockHost: event.target.value } : current))}
                    onBlur={(event) => void savePartial({ mockHost: (event.target as HTMLInputElement).value.trim() || mockDefaults?.host || '' })}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 13 }}>HTTP 端口</span>
                  <Input
                    variant="compact"
                    fullWidth
                    inputMode="numeric"
                    value={mockHttpPort || ''}
                    onChange={(event) =>
                      setSettings((current) => (current ? { ...current, mockHttpPort: numericSetting(event.target.value, mockDefaults?.httpPort ?? 0) } : current))
                    }
                    onBlur={(event) => void savePartial({ mockHttpPort: numericSetting((event.target as HTMLInputElement).value, mockDefaults?.httpPort ?? 0) })}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 13 }}>TCP 端口</span>
                  <Input
                    variant="compact"
                    fullWidth
                    inputMode="numeric"
                    value={mockTcpPort || ''}
                    onChange={(event) =>
                      setSettings((current) => (current ? { ...current, mockTcpPort: numericSetting(event.target.value, mockDefaults?.tcpPort ?? 0) } : current))
                    }
                    onBlur={(event) => void savePartial({ mockTcpPort: numericSetting((event.target as HTMLInputElement).value, mockDefaults?.tcpPort ?? 0) })}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 13 }}>限速 MB/s</span>
                  <Input
                    variant="compact"
                    fullWidth
                    inputMode="decimal"
                    value={mockRateMbps || ''}
                    onChange={(event) =>
                      setSettings((current) => (current ? { ...current, mockRateMbps: numericSetting(event.target.value, mockDefaults?.rateMbps ?? 0) } : current))
                    }
                    onBlur={(event) => void savePartial({ mockRateMbps: numericSetting((event.target as HTMLInputElement).value, mockDefaults?.rateMbps ?? 0) })}
                  />
                </label>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
