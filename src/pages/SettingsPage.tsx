import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, FolderOpen, Settings2, Trash2 } from 'lucide-react'

import { formatBytes } from '../lib/format'
import { useApp } from '../context/AppContext'
import { useStorageMigration } from '../hooks/useStorageMigration'
import type { AppSettings, CacheStats, ConnectionStatus, DeviceDefinition } from '../shared/types'
import { WatermarkManagementDialog } from '../components/WatermarkManagementDialog'
import { LutManagementDialog } from '../components/LutManagementDialog'
import { StorageMigrationDialog } from '../components/StorageMigrationDialog'
import { Button, Dialog, Input, Select, Switch, toast } from '../ui'
import '../styles/settings.css'
import '../styles/download-storage-settings.css'

interface SettingsPageProps {
  activeDevice?: DeviceDefinition
  devices: DeviceDefinition[]
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

interface DirectorySettingRowProps {
  label: string
  path: string
  onOpen: () => void
  onChange: () => void | Promise<void>
  onMigrate?: () => void
  migrating?: boolean
}

function DirectorySettingRow({ label, path, onOpen, onChange, onMigrate, migrating = false }: DirectorySettingRowProps) {
  return (
    <article className="settings-row">
      <div className="settings-row-copy">
        <span>{label}</span>
        <strong>{path || '未设置'}</strong>
      </div>
      <div className="settings-row-actions">
        <Button variant="secondary" size="compact" onClick={onOpen} icon={<FolderOpen size={15} />}>
          打开
        </Button>
        <Button variant="primary" size="compact" onClick={() => void onChange()} icon={<FolderOpen size={15} />}>
          更改
        </Button>
        {onMigrate && (
          <Button variant="secondary" size="compact" disabled={migrating} onClick={onMigrate} icon={<ArrowRightLeft size={15} />}>
            {migrating ? '迁移中' : '迁移'}
          </Button>
        )}
      </div>
    </article>
  )
}

export function SettingsPage({
  activeDevice,
  devices,
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
  const { hiddenDevMode, setHiddenDevMode } = useApp()
  const [freshCacheStats, setFreshCacheStats] = useState<CacheStats | null>(null)
  const [logDir, setLogDir] = useState('')
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false)
  const [lutManagementOpen, setLutManagementOpen] = useState(false)
  const [organizeDownloadsDialogOpen, setOrganizeDownloadsDialogOpen] = useState(false)
  const [organizingDownloads, setOrganizingDownloads] = useState(false)
  const { migrating, migrationResult, restarting, migrate, restart } = useStorageMigration(settings, setSettings)
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 连点 5 次"相机地址"激活隐藏开发模式
  const handleCameraTitleClick = useCallback(() => {
    clickCountRef.current += 1
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)

    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0
      setHiddenDevMode(true)
      toast.success('开发者模式已激活（重启后失效）')
      return
    }

    // 1.5 秒内未连点满 5 次则重置计数
    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0
    }, 1500)
  }, [setHiddenDevMode])

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let canceled = false
    window.luna.getLogDir()
      .then((dir) => {
        if (!canceled) setLogDir(dir)
      })
      .catch(() => {
        if (!canceled) setLogDir('')
      })
    return () => {
      canceled = true
    }
  }, [])

  const displayCacheStats = freshCacheStats ?? cacheStats

  async function handleClearCache(): Promise<void> {
    await clearCache()
    setFreshCacheStats(null) // 令 displayCacheStats 回退到父组件已更新的 cacheStats
    const stats = await window.luna.getCacheStats().catch(() => null)
    if (stats) setFreshCacheStats(stats)
  }

  function handleDefaultWatermarkChange(watermark: { enabled: boolean; position: NonNullable<AppSettings['defaultWatermarkPosition']> }): void {
    if (!settings) return
    if (
      settings.defaultWatermarkEnabled === watermark.enabled
      && settings.defaultWatermarkPosition === watermark.position
    ) return
    const patch = {
      defaultWatermarkEnabled: watermark.enabled,
      defaultWatermarkPosition: watermark.position,
    }
    setSettings((current) => (current ? { ...current, ...patch } : current))
    void window.luna.saveSettings(patch).then(setSettings)
  }

  function saveGpuPreviewSetting(enabled: boolean): void {
    const patch = { experimentalGpuPreview: enabled }
    setSettings((current) => (current ? { ...current, ...patch } : current))
    void window.luna.saveSettings(patch).then(setSettings)
  }

  async function saveDownloadOrganizationSetting(enabled: boolean): Promise<void> {
    if (!settings) return
    const previous = settings.organizeDownloadsByDate ?? false
    setSettings((current) => (current ? { ...current, organizeDownloadsByDate: enabled } : current))
    try {
      setSettings(await window.luna.saveSettings({ organizeDownloadsByDate: enabled }))
    } catch (error) {
      setSettings((current) => (current ? { ...current, organizeDownloadsByDate: previous } : current))
      toast.error(error instanceof Error ? error.message : '下载设置保存失败')
    }
  }

  async function saveWindowCloseBehavior(hide: boolean): Promise<void> {
    if (!settings) return
    const previous = settings.windowCloseBehavior ?? 'quit'
    const nextBehavior = hide ? 'hide' : 'quit'
    setSettings((current) => (current ? { ...current, windowCloseBehavior: nextBehavior } : current))
    try {
      setSettings(await window.luna.saveSettings({ windowCloseBehavior: nextBehavior }))
    } catch (error) {
      setSettings((current) => (current ? { ...current, windowCloseBehavior: previous } : current))
      toast.error(error instanceof Error ? error.message : '窗口设置保存失败')
    }
  }

  async function organizeOldDownloads(): Promise<void> {
    setOrganizingDownloads(true)
    try {
      const result = await window.luna.organizeDownloadedFiles()
      if (result.failed > 0) {
        toast.error(`已整理 ${result.moved} 个文件，${result.failed} 个文件整理失败`)
      } else if (result.moved > 0) {
        toast.success(`已整理 ${result.moved} 个文件${result.skipped > 0 ? `，${result.skipped} 个文件保留原处` : ''}`)
      } else {
        toast.success(result.skipped > 0 ? `没有需要移动的文件，${result.skipped} 个文件保留原处` : '没有发现可整理的旧下载')
      }
      setOrganizeDownloadsDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '旧下载整理失败')
    } finally {
      setOrganizingDownloads(false)
    }
  }

  async function changeActiveDevice(deviceId: string): Promise<void> {
    const nextDevice = devices.find((device) => device.id === deviceId)
    if (!nextDevice) return
    const mockConfig = settings?.mockServers?.[nextDevice.id]
    const next = await window.luna.saveSettings({
      activeDeviceId: nextDevice.id,
      cameraHost: nextDevice.defaultHost,
      cameraConnectionMode: 'wireless',
      mockMediaDir: mockConfig?.rootDir ?? '',
      mockHost: mockConfig?.host ?? nextDevice.mock.host,
      mockHttpPort: mockConfig?.httpPort ?? nextDevice.mock.httpPort,
      mockTcpPort: mockConfig?.tcpPort ?? nextDevice.mock.tcpPort,
      mockRateMbps: mockConfig?.rateMbps ?? nextDevice.mock.rateMbps,
    })
    setSettings(next)
  }

  return (
    <section className="settings-surface">
      <div className="settings-list">
        <section className="settings-group">
          <h2 className="settings-group-title">文件与存储</h2>
          <div className="settings-card">
            <DirectorySettingRow
              label="基础目录"
              path={settings?.baseDir ?? ''}
              onOpen={() => openDirectory(settings?.baseDir)}
              onChange={chooseBaseDir}
              onMigrate={() => void migrate()}
              migrating={migrating}
            />
            <DirectorySettingRow
              label="下载目录"
              path={settings?.localResourcesDir ?? (settings?.baseDir ? `${settings.baseDir}/localResources` : '')}
              onOpen={() => openDirectory(settings?.localResourcesDir)}
              onChange={chooseLocalResourcesDir}
            />
            <article className="settings-row download-storage-setting-row">
              <div className="settings-row-copy">
                <span>按日期分文件夹</span>
                <em>{settings?.organizeDownloadsByDate ? '新下载会放入拍摄日期文件夹' : '新下载直接保存在下载目录中'}</em>
              </div>
              <div className="download-storage-setting-actions">
                {settings?.organizeDownloadsByDate && (
                  <Button
                    variant="secondary"
                    size="compact"
                    disabled={organizingDownloads}
                    onClick={() => setOrganizeDownloadsDialogOpen(true)}
                    icon={<ArrowRightLeft size={15} />}
                  >
                    {organizingDownloads ? '整理中' : '整理旧下载'}
                  </Button>
                )}
                <Switch
                  checked={settings?.organizeDownloadsByDate ?? false}
                  disabled={!settings || organizingDownloads}
                  ariaLabel="按日期分文件夹"
                  onCheckedChange={(enabled) => void saveDownloadOrganizationSetting(enabled)}
                />
              </div>
            </article>
            <DirectorySettingRow
              label="导出目录"
              path={settings?.exportDir ?? ''}
              onOpen={() => openDirectory(settings?.exportDir)}
              onChange={chooseExportDir}
            />
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>LUT 目录</span>
                <strong>{settings?.lutDir || (settings?.baseDir ? `${settings.baseDir}/luts` : '未设置')}</strong>
              </div>
              <div className="settings-row-actions">
                <Button variant="secondary" size="compact" onClick={() => setLutManagementOpen(true)} icon={<Settings2 size={15} />}>
                  管理
                </Button>
                <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.lutDir || (settings?.baseDir ? `${settings.baseDir}/luts` : null))} icon={<FolderOpen size={15} />}>
                  打开
                </Button>
                <Button variant="primary" size="compact" icon={<FolderOpen size={15} />} onClick={async () => {
                  const result = await window.luna.chooseLutDir().catch(() => null)
                  if (!result) return
                  await window.luna.saveSettings({ lutDir: result }).then(setSettings)
                  toast.success('LUT 目录已更新')
                }}>
                  更改
                </Button>
                {settings?.lutDir && (
                  <Button variant="secondary" size="compact" onClick={async () => {
                    setSettings((current) => (current ? { ...current, lutDir: undefined } : current))
                    await window.luna.saveSettings({ lutDir: undefined }).then(setSettings)
                    toast.success('已恢复默认 LUT 目录')
                  }}>
                    恢复默认
                  </Button>
                )}
              </div>
            </article>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">应用行为</h2>
          <div className="settings-card">
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>关闭窗口时隐藏</span>
                <em>{settings?.windowCloseBehavior === 'hide' ? '关闭按钮只隐藏窗口，应用仍会继续运行' : '关闭按钮会退出应用'}</em>
              </div>
              <Switch
                checked={settings?.windowCloseBehavior === 'hide'}
                disabled={!settings}
                ariaLabel="关闭窗口时隐藏"
                onCheckedChange={(enabled) => void saveWindowCloseBehavior(enabled)}
              />
            </article>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">编辑默认值</h2>
          <div className="settings-card">
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>水印</span>
                <em>{settings?.defaultWatermarkEnabled ?? true ? '默认开启' : '默认关闭'}</em>
              </div>
              <Button variant="secondary" size="compact" icon={<Settings2 size={15} />} onClick={() => setWatermarkDialogOpen(true)}>编辑</Button>
            </article>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">预览</h2>
          <div className="settings-card">
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>加速预览</span>
                <em>应用会自动选择兼容的预览方式；出现问题时会自动切回普通预览</em>
              </div>
              <Switch
                checked={settings?.experimentalGpuPreview ?? true}
                disabled={!settings}
                ariaLabel="加速预览"
                onCheckedChange={saveGpuPreviewSetting}
              />
            </article>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-group-title">连接与维护</h2>
          <div className="settings-card">
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>当前设备</span>
                <em>{activeDevice?.vendor ?? '相机'}连接配置</em>
              </div>
              <Select
                variant="compact"
                value={activeDevice?.id}
                options={devices.map((device) => ({ value: device.id, label: `${device.vendor} ${device.name}` }))}
                placeholder="选择设备"
                onValueChange={(value) => void changeActiveDevice(value)}
              />
            </article>
            <article className="settings-row">
              <div className="settings-row-copy">
                <span
                  className="settings-secret-trigger"
                  onClick={handleCameraTitleClick}
                  title={hiddenDevMode ? '隐藏开发模式已激活' : '相机地址'}
                >
                  相机地址 {hiddenDevMode && <small>开发模式</small>}
                </span>
                <em>{connection?.message ?? `${activeDevice?.name ?? '设备'}：${activeDevice?.defaultHost || '未配置'}`}</em>
              </div>
              <Input
                variant="compact"
                value={settings?.cameraHost ?? ''}
                onChange={(event) => setSettings((current) => (current ? { ...current, cameraHost: event.target.value } : current))}
                onBlur={(event) => window.luna.saveSettings({ cameraHost: (event.target as HTMLInputElement).value }).then(setSettings)}
              />
            </article>
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>缓存</span>
                <strong>{formatBytes(displayCacheStats?.bytes)} · {displayCacheStats?.files ?? 0} 个文件</strong>
              </div>
              <div className="settings-row-actions">
                <Button variant="secondary" size="compact" onClick={() => openDirectory(displayCacheStats?.dir ?? settings?.cacheDir)} icon={<FolderOpen size={15} />}>
                  打开
                </Button>
                <Button variant="secondary" size="compact" onClick={handleClearCache} icon={<Trash2 size={15} />}>
                  清理
                </Button>
              </div>
            </article>
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>日志</span>
                <strong>{logDir || '正在读取'}</strong>
              </div>
              <div className="settings-row-actions">
                <Button variant="secondary" size="compact" onClick={() => {
                  if (logDir) openDirectory(logDir)
                  else void window.luna.getLogDir().then(dir => {
                    setLogDir(dir)
                    openDirectory(dir)
                  })
                }} icon={<FolderOpen size={15} />}>
                  打开
                </Button>
                <Button variant="secondary" size="compact" onClick={async () => {
                  await window.luna.clearLogs()
                  toast.success('日志已清空')
                }} icon={<Trash2 size={15} />}>
                  清空
                </Button>
              </div>
            </article>
          </div>
        </section>
      </div>
      <WatermarkManagementDialog
        open={watermarkDialogOpen}
        onOpenChange={setWatermarkDialogOpen}
        settings={settings}
        onDefaultChange={handleDefaultWatermarkChange}
      />
      <LutManagementDialog open={lutManagementOpen} onOpenChange={setLutManagementOpen} />
      <Dialog
        open={organizeDownloadsDialogOpen}
        onOpenChange={(open) => {
          if (!organizingDownloads) setOrganizeDownloadsDialogOpen(open)
        }}
        title="整理旧下载？"
        description="应用会把下载目录根目录中的媒体文件移入 YYYY-MM-DD 文件夹。无法识别拍摄日期或遇到同名文件的项目会保留原处。"
        footer={(
          <>
            <Button variant="secondary" disabled={organizingDownloads} onClick={() => setOrganizeDownloadsDialogOpen(false)}>取消</Button>
            <Button variant="primary" disabled={organizingDownloads} onClick={() => void organizeOldDownloads()}>
              {organizingDownloads ? '整理中' : '开始整理'}
            </Button>
          </>
        )}
      />
      <StorageMigrationDialog
        migrating={migrating}
        result={migrationResult}
        restarting={restarting}
        onRestart={() => void restart()}
      />
    </section>
  )
}
