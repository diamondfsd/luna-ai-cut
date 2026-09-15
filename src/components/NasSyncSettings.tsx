import { useEffect, useRef, useState } from 'react'
import { FolderOpen, HardDrive, Link, Save } from 'lucide-react'

import type { AppSettings, NasShare, NasSyncSettings as NasSettings } from '../shared/types'
import { Button, Dialog, Input, Select, Switch, toast } from '../ui'
import '../styles/nas-sync-settings.css'

const emptyConfig: NasSettings = {
  enabled: false,
  autoSync: false,
  server: '',
  share: '',
  remotePath: '',
  username: '',
  password: '',
}

interface NasSyncSettingsProps {
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
}

function configFromSettings(settings: AppSettings | null): NasSettings {
  return { ...emptyConfig, ...(settings?.nasSync ?? {}) }
}

function directoryLabel(directory: string): string {
  return directory === '/' ? '共享根目录' : directory
}

export function NasSyncSettings({ settings, setSettings }: NasSyncSettingsProps) {
  const [form, setForm] = useState<NasSettings>(() => configFromSettings(settings))
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [shareOptions, setShareOptions] = useState<NasShare[]>([])
  const [directoryOptions, setDirectoryOptions] = useState<string[]>([])
  const [selectedShare, setSelectedShare] = useState('')
  const [selectedDirectory, setSelectedDirectory] = useState('')
  const [directoryDialogOpen, setDirectoryDialogOpen] = useState(false)
  const [loadingDirectories, setLoadingDirectories] = useState(false)
  const directoryRequestId = useRef(0)

  useEffect(() => {
    const next = configFromSettings(settings)
    setForm(next)
    setSelectedShare(next.share)
    setSelectedDirectory(next.remotePath)
  }, [settings])

  function updateForm(patch: Partial<NasSettings>): void {
    setForm((current) => ({ ...current, ...patch }))
  }

  function updateConnection(patch: Partial<NasSettings>): void {
    setForm((current) => ({ ...current, ...patch, share: '', remotePath: '' }))
    setSelectedShare('')
    setSelectedDirectory('')
  }

  const connectionReady = Boolean(form.server.trim())
  const configured = connectionReady && Boolean(form.share.trim()) && Boolean(form.remotePath.trim())

  function normalizedConfig(config: NasSettings): NasSettings {
    return { ...config, server: config.server.trim(), share: config.share.trim(), remotePath: config.remotePath.trim() }
  }

  async function saveConfig(): Promise<void> {
    if (!configured) {
      toast.error('请先连接 NAS 并选择共享和同步目录')
      return
    }
    setBusy(true)
    try {
      const nextConfig = normalizedConfig(form)
      const next = await window.luna.saveSettings({ nasSync: nextConfig })
      setSettings(next)
      setForm(configFromSettings(next))
      toast.success('NAS 配置已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'NAS 配置保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function loadDirectories(share: string): Promise<void> {
    const requestId = directoryRequestId.current + 1
    directoryRequestId.current = requestId
    setLoadingDirectories(true)
    try {
      const result = await window.luna.nasSync.probe(normalizedConfig({ ...form, share, remotePath: '' }))
      if (requestId !== directoryRequestId.current) return
      if (!result.ok) {
        toast.error(result.message ?? 'NAS 连接失败')
        setDirectoryOptions([])
        return
      }
      const directories = result.directories ?? []
      setDirectoryOptions(directories)
      setSelectedDirectory(form.share === share && directories.includes(form.remotePath) ? form.remotePath : '')
      if (directories.length === 0) toast.error('NAS 共享中没有可选目录')
    } catch (error) {
      if (requestId !== directoryRequestId.current) return
      setDirectoryOptions([])
      toast.error(error instanceof Error ? error.message : 'NAS 连接失败')
    } finally {
      if (requestId === directoryRequestId.current) setLoadingDirectories(false)
    }
  }

  async function probe(): Promise<void> {
    setChecking(true)
    try {
      const result = await window.luna.nasSync.probe(normalizedConfig({ ...form, share: '', remotePath: '' }))
      if (!result.ok) {
        toast.error(result.message ?? 'NAS 连接失败')
        return
      }
      const shares = (result.shares ?? []).filter((share) => share.type === 'disk')
      if (shares.length === 0) {
        toast.error('NAS 中没有可用共享目录')
        return
      }
      const previousShare = shares.some((share) => share.name === form.share) ? form.share : ''
      setShareOptions(shares)
      setSelectedShare(previousShare)
      setDirectoryOptions([])
      setSelectedDirectory('')
      setDirectoryDialogOpen(true)
      if (previousShare) await loadDirectories(previousShare)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'NAS 连接失败')
    } finally {
      setChecking(false)
    }
  }

  function confirmDirectory(): void {
    if (!selectedShare || !selectedDirectory) {
      toast.error('请选择共享和同步目录')
      return
    }
    updateForm({ share: selectedShare, remotePath: selectedDirectory })
    setDirectoryDialogOpen(false)
  }

  async function saveSwitch(patch: Partial<NasSettings>): Promise<void> {
    const previous = form
    const nextConfig = normalizedConfig({ ...previous, ...patch })
    setForm(nextConfig)
    setSettings((current) => (current ? { ...current, nasSync: nextConfig } : current))
    try {
      const next = await window.luna.saveSettings({ nasSync: nextConfig })
      setSettings(next)
      setForm(configFromSettings(next))
    } catch (error) {
      setForm(previous)
      setSettings((current) => (current ? { ...current, nasSync: previous } : current))
      toast.error(error instanceof Error ? error.message : 'NAS 设置保存失败')
    }
  }

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">NAS 同步</h2>
      <div className="settings-card nas-settings-card">
        <article className="settings-row">
          <div className="settings-row-copy">
            <span><HardDrive size={15} aria-hidden="true" />启用 NAS 同步</span>
            <em>{form.enabled ? '可将本地文件同步到 NAS' : '未启用'}</em>
          </div>
          <Switch checked={form.enabled} disabled={!settings || (!form.enabled && !configured)} ariaLabel="启用 NAS 同步" onCheckedChange={(enabled) => void saveSwitch({ enabled })} />
        </article>
        <article className="settings-row">
          <div className="settings-row-copy">
            <span>自动同步新下载</span>
            <em>{form.autoSync ? '本地下载完成后自动同步' : '仅手动同步已选文件'}</em>
          </div>
          <Switch
            checked={form.autoSync}
            disabled={!settings || !form.enabled || !configured}
            ariaLabel="自动同步新下载"
            onCheckedChange={(autoSync) => void saveSwitch({ autoSync })}
          />
        </article>
        <div className="nas-settings-form">
          <label>
            <span>服务器地址</span>
            <Input variant="compact" fullWidth value={form.server} placeholder="例如 192.168.1.20" onChange={(event) => updateConnection({ server: event.target.value })} />
          </label>
          <label>
            <span>用户名</span>
            <Input variant="compact" fullWidth value={form.username} onChange={(event) => updateConnection({ username: event.target.value })} />
          </label>
          <label>
            <span>密码</span>
            <Input variant="compact" type="password" fullWidth value={form.password} onChange={(event) => updateConnection({ password: event.target.value })} />
          </label>
          <div className="nas-selected-directory">
            <span>共享 / 同步目录</span>
            <strong>{form.share && form.remotePath ? `${form.share} / ${directoryLabel(form.remotePath)}` : '未选择'}</strong>
          </div>
          <div className="nas-settings-actions">
            <Button variant="secondary" size="compact" disabled={checking || !connectionReady} icon={<Link size={14} />} onClick={() => void probe()}>
              {checking ? '连接中' : '连接并选择目录'}
            </Button>
            <Button variant="primary" size="compact" disabled={busy || !configured} icon={<Save size={14} />} onClick={() => void saveConfig()}>
              {busy ? '保存中' : '保存配置'}
            </Button>
          </div>
        </div>
      </div>
      <Dialog
        open={directoryDialogOpen}
        onOpenChange={setDirectoryDialogOpen}
        title="选择同步目录"
        description="先选择共享，再选择同步目录"
        className="nas-directory-dialog"
        footer={(
          <>
            <Button variant="secondary" size="compact" onClick={() => setDirectoryDialogOpen(false)}>取消</Button>
            <Button variant="primary" size="compact" disabled={!selectedShare || !selectedDirectory || loadingDirectories} icon={<FolderOpen size={14} />} onClick={confirmDirectory}>选择目录</Button>
          </>
        )}
      >
        <div className="nas-directory-picker">
          <label>
            <span>共享目录</span>
            <Select
              variant="compact"
              fullWidth
              options={shareOptions.map((share) => ({ value: share.name, label: share.name }))}
              value={selectedShare}
              placeholder="请选择共享目录"
              onValueChange={(share) => {
                setSelectedShare(share)
                setSelectedDirectory('')
                void loadDirectories(share)
              }}
            />
          </label>
          <label>
            <span>同步目录</span>
            <Select
              variant="compact"
              fullWidth
              options={directoryOptions.map((directory) => ({ value: directory, label: directoryLabel(directory) }))}
              value={selectedDirectory}
              placeholder={loadingDirectories ? '读取中' : '请选择同步目录'}
              disabled={!selectedShare || loadingDirectories || directoryOptions.length === 0}
              onValueChange={setSelectedDirectory}
            />
          </label>
        </div>
      </Dialog>
    </section>
  )
}
