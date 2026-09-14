import { useEffect, useState } from 'react'
import { HardDrive, Link, Save } from 'lucide-react'

import type { AppSettings, NasSyncSettings as NasSettings } from '../shared/types'
import { Button, Input, Switch, toast } from '../ui'
import '../styles/nas-sync-settings.css'

const emptyConfig: NasSettings = {
  enabled: false,
  autoSync: false,
  server: '',
  share: 'lunaaicut',
  remotePath: 'lunaaicut',
  username: '',
  password: '',
}

const fixedNasConfig: Pick<NasSettings, 'share' | 'remotePath'> = {
  share: 'lunaaicut',
  remotePath: 'lunaaicut',
}

interface NasSyncSettingsProps {
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
}

function configFromSettings(settings: AppSettings | null): NasSettings {
  return { ...emptyConfig, ...(settings?.nasSync ?? {}), ...fixedNasConfig }
}

export function NasSyncSettings({ settings, setSettings }: NasSyncSettingsProps) {
  const [form, setForm] = useState<NasSettings>(() => configFromSettings(settings))
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    setForm(configFromSettings(settings))
  }, [settings])

  function updateForm(patch: Partial<NasSettings>): void {
    setForm((current) => ({ ...current, ...patch }))
  }

  const configured = Boolean(form.server.trim())

  function normalizedConfig(config: NasSettings): NasSettings {
    return { ...config, ...fixedNasConfig }
  }

  async function saveConfig(): Promise<void> {
    setBusy(true)
    try {
      const nextConfig = normalizedConfig({ ...form, server: form.server.trim() })
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

  async function probe(): Promise<void> {
    setChecking(true)
    try {
      const result = await window.luna.nasSync.probe(normalizedConfig({ ...form, server: form.server.trim() }))
      if (result.ok) toast.success('NAS 连接成功')
      else toast.error(result.message ?? 'NAS 连接失败')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'NAS 连接失败')
    } finally {
      setChecking(false)
    }
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
          <Switch checked={form.enabled} disabled={!settings} ariaLabel="启用 NAS 同步" onCheckedChange={(enabled) => void saveSwitch({ enabled })} />
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
            <Input variant="compact" fullWidth value={form.server} placeholder="例如 192.168.1.20" onChange={(event) => updateForm({ server: event.target.value })} />
          </label>
          <label>
            <span>用户名</span>
            <Input variant="compact" fullWidth value={form.username} onChange={(event) => updateForm({ username: event.target.value })} />
          </label>
          <label>
            <span>密码</span>
            <Input variant="compact" type="password" fullWidth value={form.password} onChange={(event) => updateForm({ password: event.target.value })} />
          </label>
          <div className="nas-settings-actions">
            <Button variant="secondary" size="compact" disabled={checking || !form.server.trim()} icon={<Link size={14} />} onClick={() => void probe()}>
              {checking ? '检测中' : '检测连接'}
            </Button>
            <Button variant="primary" size="compact" disabled={busy} icon={<Save size={14} />} onClick={() => void saveConfig()}>
              {busy ? '保存中' : '保存配置'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
