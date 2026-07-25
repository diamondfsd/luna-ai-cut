import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { formatBytes } from '../lib/format'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { useApp } from '../context/AppContext'
import type { AppSettings, CacheStats, ConnectionStatus, CustomWatermarkAsset, DeviceDefinition } from '../shared/types'
import { removeCustomWatermarkAsset } from '../shared/watermarkLibrary'
import { WatermarkSettings } from '../components/WatermarkSettings'
import { Button, Input, Switch, toast } from '../ui'
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

  async function handleAddCustomWatermark(): Promise<void> {
    const assets = await window.luna.chooseCustomWatermarks().catch((error) => {
      toast.error(error instanceof Error ? error.message : '无法导入这张水印图片')
      return []
    })
    if (assets.length === 0) return
    setSettings(await window.luna.getSettings())
    toast.success(`已添加 ${assets.length} 个水印`)
  }

  async function handleDeleteCustomWatermark(asset: CustomWatermarkAsset): Promise<void> {
    if (!settings) return
    const patch: Partial<AppSettings> = {
      customWatermarkAssets: removeCustomWatermarkAsset(settings.customWatermarkAssets ?? [], asset.id),
    }
    if (settings.recentWatermarkSettings?.customAsset?.id === asset.id) {
      patch.recentWatermarkSettings = {
        ...settings.recentWatermarkSettings,
        sourceKind: 'builtin',
        position: settings.recentWatermarkSettings.position === 'top-center' ? 'bottom-center' : settings.recentWatermarkSettings.position,
        customAsset: undefined,
        imagePath: undefined,
        imageWidth: undefined,
        imageHeight: undefined,
        sizeOnShortEdge: undefined,
        placement: undefined,
        opacity: undefined,
      }
    }
    setSettings(await window.luna.saveSettings(patch))
    toast.success('水印已从列表中删除')
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
            <article className="settings-row settings-default-watermark-row">
              <div className="settings-row-copy">
                <span>水印</span>
                <em>用于新导入或重置的素材</em>
              </div>
              <div className="settings-default-watermark-control">
                <WatermarkSettings
                  preferencesOnly
                  title="默认开启"
                  settings={{
                    enabled: settings?.defaultWatermarkEnabled ?? true,
                    style: 'luna_ultra_cn',
                    position: settings?.defaultWatermarkPosition === 'top-center'
                      ? 'bottom-center'
                      : settings?.defaultWatermarkPosition ?? 'bottom-center',
                  }}
                  onChange={handleDefaultWatermarkChange}
                />
              </div>
            </article>
          </div>
        </section>

        <section className="settings-group">
          <div className="settings-group-heading">
            <h2 className="settings-group-title">水印管理</h2>
            <Button variant="primary" size="compact" icon={<FolderOpen size={15} />} onClick={() => void handleAddCustomWatermark()}>
              添加水印
            </Button>
          </div>
          <div className="settings-card">
            {(settings?.customWatermarkAssets?.length ?? 0) > 0 ? settings?.customWatermarkAssets?.map((asset) => (
              <article key={asset.id} className="settings-row settings-watermark-row">
                <img className="settings-watermark-preview" src={filePathToPreviewUrl(asset.filePath) ?? ''} alt="" />
                <div className="settings-row-copy">
                  <span>{asset.fileName}</span>
                  <em>{asset.width} x {asset.height} · {formatBytes(asset.bytes)}</em>
                </div>
                <Button variant="danger" size="compact" icon={<Trash2 size={15} />} onClick={() => void handleDeleteCustomWatermark(asset)}>
                  删除
                </Button>
              </article>
            )) : (
              <article className="settings-row">
                <div className="settings-row-copy">
                  <span>暂无自定义水印</span>
                </div>
              </article>
            )}
          </div>
        </section>

        {window.navigator.platform.includes('Mac') && (
          <section className="settings-group">
            <h2 className="settings-group-title">导出</h2>
            <div className="settings-card">
              <article className="settings-row">
                <div className="settings-row-copy">
                  <span>保存 Live Photo 到系统相册</span>
                </div>
                <Switch
                  checked={!!settings?.exportAppleLivePhoto}
                  onCheckedChange={(checked) => {
                    setSettings((current) => (current ? { ...current, exportAppleLivePhoto: checked } : current))
                    void window.luna.saveSettings({ exportAppleLivePhoto: checked }).then(setSettings)
                  }}
                  ariaLabel="保存 Live Photo 到系统相册"
                />
              </article>
            </div>
          </section>
        )}

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
    </section>
  )
}
