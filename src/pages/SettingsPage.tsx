import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Settings2, Trash2 } from 'lucide-react'

import { formatBytes } from '../lib/format'
import { useApp } from '../context/AppContext'
import type { AppSettings, CacheStats, ConnectionStatus, DeviceDefinition } from '../shared/types'
import { WatermarkManagementDialog } from '../components/WatermarkManagementDialog'
import { LutManagementDialog } from '../components/LutManagementDialog'
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

interface DirectorySettingRowProps {
  label: string
  path: string
  onOpen: () => void
  onChange: () => void | Promise<void>
}

function DirectorySettingRow({ label, path, onOpen, onChange }: DirectorySettingRowProps) {
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
      </div>
    </article>
  )
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
  const { hiddenDevMode, setHiddenDevMode } = useApp()
  const [freshCacheStats, setFreshCacheStats] = useState<CacheStats | null>(null)
  const [logDir, setLogDir] = useState('')
  const [watermarkDialogOpen, setWatermarkDialogOpen] = useState(false)
  const [lutManagementOpen, setLutManagementOpen] = useState(false)
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

  return (
    <section className="settings-surface">
      <div className="settings-list">
        <section className="settings-group">
          <h2 className="settings-group-title">文件与存储</h2>
          <div className="settings-card">
            <DirectorySettingRow
              label="基础目录"
              path={settings?.downloadDir ?? ''}
              onOpen={() => openDirectory(settings?.downloadDir)}
              onChange={chooseBaseDir}
            />
            <DirectorySettingRow
              label="下载目录"
              path={settings?.localResourcesDir ?? (settings?.downloadDir ? `${settings.downloadDir}/localResources` : '')}
              onOpen={() => openDirectory(settings?.localResourcesDir)}
              onChange={chooseLocalResourcesDir}
            />
            <DirectorySettingRow
              label="导出目录"
              path={settings?.exportDir ?? ''}
              onOpen={() => openDirectory(settings?.exportDir)}
              onChange={chooseExportDir}
            />
            <article className="settings-row">
              <div className="settings-row-copy">
                <span>LUT 目录</span>
                <strong>{settings?.lutDir || (settings?.downloadDir ? `${settings.downloadDir}/luts` : '未设置')}</strong>
              </div>
              <div className="settings-row-actions">
                <Button variant="secondary" size="compact" onClick={() => setLutManagementOpen(true)} icon={<Settings2 size={15} />}>
                  管理
                </Button>
                <Button variant="secondary" size="compact" onClick={() => openDirectory(settings?.lutDir || (settings?.downloadDir ? `${settings.downloadDir}/luts` : null))} icon={<FolderOpen size={15} />}>
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
          <h2 className="settings-group-title">连接与维护</h2>
          <div className="settings-card">
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
    </section>
  )
}
