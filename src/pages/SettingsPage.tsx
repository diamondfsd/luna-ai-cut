import { useEffect, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { formatBytes } from '../lib/format'
import type { AppSettings, CacheStats, ConnectionStatus, DeviceDefinition } from '../shared/types'
import { Button, Input, toast } from '../ui'
import '../styles/settings.css'

interface SettingsPageProps {
  activeDevice?: DeviceDefinition
  cacheStats: CacheStats | null
  chooseBaseDir: () => Promise<void>
  chooseLocalResourcesDir: () => Promise<void>
  chooseExportDir: () => Promise<void>
  clearCache: () => Promise<void>
  connection: ConnectionStatus | null
  openDirectory: (targetPath: string | null | undefined) => void
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
}

export function SettingsPage({
  activeDevice,
  cacheStats,
  chooseBaseDir,
  chooseLocalResourcesDir,
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

  async function handleClearCache(): Promise<void> {
    await clearCache()
    setFreshCacheStats(null) // 令 displayCacheStats 回退到父组件已更新的 cacheStats
    const stats = await window.luna.getCacheStats().catch(() => null)
    if (stats) setFreshCacheStats(stats)
  }

  return (
    <section className="settings-surface">
      {/* ===== 通用设置 ===== */}
      <div className="settings-list">
        <h3 className="settings-group-title">通用</h3>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>基础目录</span>
            <strong>{settings?.downloadDir}</strong>
            <em>缓存、预览等通用文件存放位置</em>
          </div>
          <div className="settings-row-actions">
            <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.downloadDir)} icon={<FolderOpen size={15} />}>
              打开
            </Button>
            <Button variant="primary" size="compact" onClick={chooseBaseDir} icon={<FolderOpen size={15} />}>
              更换目录
            </Button>
          </div>
        </article>

        <article className="settings-row">
          <div className="settings-row-copy">
            <span>本地资源目录</span>
            <strong>{settings?.localResourcesDir ?? (settings?.downloadDir ? settings.downloadDir + '/localResources' : '')}</strong>
            <em>从相机下载的素材存放位置</em>
          </div>
          <div className="settings-row-actions">
            <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.localResourcesDir)} icon={<FolderOpen size={15} />}>
              打开
            </Button>
            <Button variant="primary" size="compact" onClick={chooseLocalResourcesDir} icon={<FolderOpen size={15} />}>
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
            <span>日志目录</span>
            <em>主进程和渲染进程的运行日志，按天轮转</em>
          </div>
          <div className="settings-row-actions">
            <Button variant="secondary" size="compact" onClick={() => {
              void window.luna.getLogDir().then(dir => openDirectory(dir))
            }} icon={<FolderOpen size={15} />}>
              打开
            </Button>
            <Button variant="secondary" size="compact" onClick={async () => {
              await window.luna.clearLogs()
              toast.success('日志已清空')
            }} icon={<Trash2 size={15} />}>
              清空日志
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
            <em>{connection?.message ?? `${activeDevice?.name ?? '设备'} 默认地址：${activeDevice?.defaultHost || '未配置'}`}</em>
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
