import { useEffect, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { formatBytes } from '../lib/format'
import type { AppSettings, CacheStats, ConnectionStatus, DeviceDefinition } from '../shared/types'
import { Button, Input, SegmentedControl } from '../ui'
import '../styles/settings.css'

interface SettingsPageProps {
  activeDevice?: DeviceDefinition
  devices: DeviceDefinition[]
  cacheStats: CacheStats | null
  chooseDir: () => Promise<void>
  chooseExportDir: () => Promise<void>
  clearCache: () => Promise<void>
  connection: ConnectionStatus | null
  openDirectory: (targetPath: string | null | undefined) => void
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
}

export function SettingsPage({
  activeDevice,
  devices,
  cacheStats,
  chooseDir,
  chooseExportDir,
  clearCache,
  connection,
  openDirectory,
  settings,
  setSettings,
}: SettingsPageProps) {
  const [freshCacheStats, setFreshCacheStats] = useState<CacheStats | null>(null)

  // 每次进入设置页重新获取缓存统计
  useEffect(() => {
    window.luna.getCacheStats().then(setFreshCacheStats).catch(() => {})
  }, [])

  const displayCacheStats = freshCacheStats ?? cacheStats
  const deviceName = activeDevice?.name ?? '设备'

  async function handleClearCache(): Promise<void> {
    await clearCache()
    setFreshCacheStats(null) // 令 displayCacheStats 回退到父组件已更新的 cacheStats
    const stats = await window.luna.getCacheStats().catch(() => null)
    if (stats) setFreshCacheStats(stats)
  }

  async function savePartial(partial: Partial<AppSettings>): Promise<AppSettings> {
    const updated = await window.luna.saveSettings(partial)
    setSettings(updated)
    return updated
  }

  async function switchDevice(deviceId: string): Promise<void> {
    const device = devices.find((item) => item.id === deviceId)
    if (!device) return

    await savePartial({
      activeDeviceId: device.id,
      cameraHost: device.defaultHost,
      deviceStorage: {
        ...(settings?.deviceStorage ?? {}),
        [device.id]: settings?.deviceStorage?.[device.id] ?? 'all',
      },
      mockHost: device.mock.host,
      mockHttpPort: device.mock.httpPort,
      mockTcpPort: device.mock.tcpPort,
      mockRateMbps: device.mock.rateMbps,
    })
  }

  return (
    <section className="settings-surface">
      {/* ===== 通用设置 ===== */}
      <div className="settings-list">
        <h3 className="settings-group-title">通用</h3>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>设备类型</span>
            <strong>{deviceName}</strong>
          </div>
          {devices.length > 1 && (
            <SegmentedControl
              ariaLabel="选择设备类型"
              options={devices.map((device) => ({ value: device.id, label: device.name }))}
              value={activeDevice?.id ?? devices[0]?.id ?? ''}
              onChange={(value) => void switchDevice(value)}
            />
          )}
        </article>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>下载目录</span>
            <strong>{settings?.downloadDir}</strong>
          </div>
          <div className="settings-row-actions">
            <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.downloadDir)} icon={<FolderOpen size={15} />}>
              打开
            </Button>
            <Button variant="primary" size="compact" onClick={chooseDir} icon={<FolderOpen size={15} />}>
              更换目录
            </Button>
          </div>
        </article>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>导出目录</span>
            <strong>{settings?.exportDir}</strong>
            <em>水印合成后的文件将导出到此目录</em>
          </div>
          <div className="settings-row-actions">
            <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.exportDir)} icon={<FolderOpen size={15} />}>
              打开
            </Button>
            <Button variant="primary" size="compact" onClick={chooseExportDir} icon={<FolderOpen size={15} />}>
              更换目录
            </Button>
          </div>
        </article>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>缓存</span>
            <strong>{formatBytes(displayCacheStats?.bytes)}</strong>
            <em>
              {displayCacheStats?.files ?? 0} 个文件 · {displayCacheStats?.dir}
            </em>
          </div>
          <div className="settings-row-actions">
            <Button
              variant="secondary"
              size="compact"
              onClick={() => openDirectory(displayCacheStats?.dir ?? settings?.cacheDir)}
              icon={<FolderOpen size={15} />}
            >
              打开
            </Button>
            <Button variant="secondary" size="compact" onClick={handleClearCache} icon={<Trash2 size={15} />}>
              清理缓存
            </Button>
          </div>
        </article>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>相机地址</span>
            <em>{connection?.message ?? `${deviceName} 默认地址：${activeDevice?.defaultHost || '未配置'}`}</em>
          </div>
          <Input
            variant="pill"
            value={settings?.cameraHost ?? ''}
            onChange={(event) => setSettings((current) => (current ? { ...current, cameraHost: event.target.value } : current))}
            onBlur={(event) => window.luna.saveSettings({ cameraHost: (event.target as HTMLInputElement).value }).then(setSettings)}
          />
        </article>

	      </div>
    </section>
  )
}
