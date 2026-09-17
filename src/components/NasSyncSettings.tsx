import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Folder, FolderCog, FolderSync, HardDrive, Settings2 } from 'lucide-react'

import { useNasSyncProgress } from '../context/NasSyncProgressContext'
import type { AppSettings, NasShare, NasSyncSettings as NasSettings } from '../shared/types'
import { Button, Dialog, IconButton, Input, Switch, Tooltip, toast } from '../ui'
import '../styles/nas-sync-settings.css'

const emptyConfig: NasSettings = {
  enabled: false,
  autoSync: false,
  server: '',
  port: 445,
  share: '',
  remotePath: '',
  username: '',
  password: '',
  concurrency: 3,
}
type SetupStep = 'connection' | 'directory' | 'complete'

interface NasSyncSettingsProps {
  settings: AppSettings | null
  setSettings: (updater: AppSettings | ((current: AppSettings | null) => AppSettings | null)) => void
  openSetup?: boolean
}

function configFromSettings(settings: AppSettings | null): NasSettings {
  return { ...emptyConfig, ...(settings?.nasSync ?? {}) }
}

function joinDirectory(parent: string, child: string): string {
  return [parent === '/' ? '' : parent, child].filter(Boolean).join('/')
}

function parentDirectory(directory: string): string {
  const parts = directory.split('/').filter(Boolean)
  parts.pop()
  return parts.length === 0 ? '/' : parts.join('/')
}

function targetLabel(config: NasSettings): string {
  if (!config.share || !config.remotePath) return '未配置'
  return `${config.share}${config.remotePath === '/' ? '' : ` / ${config.remotePath}`}`
}

export function NasSyncSettings({ settings, setSettings, openSetup = false }: NasSyncSettingsProps) {
  const { showProgress } = useNasSyncProgress()
  const [form, setForm] = useState<NasSettings>(() => configFromSettings(settings))
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState<SetupStep>('connection')
  const [busy, setBusy] = useState(false)
  const [syncingLocalResources, setSyncingLocalResources] = useState(false)
  const [shareOptions, setShareOptions] = useState<NasShare[]>([])
  const [directoryOptions, setDirectoryOptions] = useState<string[]>([])
  const [selectedShare, setSelectedShare] = useState('')
  const [selectedDirectory, setSelectedDirectory] = useState('')
  const [loadingDirectories, setLoadingDirectories] = useState(false)
  const directoryRequestId = useRef(0)
  const openedFromNavigation = useRef(false)

  useEffect(() => {
    setForm(configFromSettings(settings))
  }, [settings])

  const connectionReady = Boolean(form.server.trim())
  const validPort = Number.isInteger(form.port) && form.port >= 1 && form.port <= 65535
  const configured = connectionReady && validPort && Boolean(form.share.trim()) && Boolean(form.remotePath.trim())

  function normalizedConfig(config: NasSettings): NasSettings {
    return {
      ...config,
      server: config.server.trim(),
      share: config.share.trim(),
      remotePath: config.remotePath.trim(),
      concurrency: Math.min(10, Math.max(1, Math.round(config.concurrency || 3))),
    }
  }

  function updateConnection(patch: Partial<NasSettings>): void {
    setForm((current) => ({ ...current, ...patch, share: '', remotePath: '' }))
  }

  function closeWizard(open: boolean): void {
    if (!open && busy) return
    setWizardOpen(open)
    if (!open) {
      directoryRequestId.current += 1
      setForm(configFromSettings(settings))
    }
  }

  const openWizard = useCallback((): void => {
    const config = configFromSettings(settings)
    setForm(config)
    setStep('connection')
    setShareOptions([])
    setDirectoryOptions([])
    setSelectedShare(config.share)
    setSelectedDirectory(config.remotePath)
    setWizardOpen(true)
  }, [settings])

  useEffect(() => {
    if (!openSetup || openedFromNavigation.current) return
    openedFromNavigation.current = true
    openWizard()
  }, [openSetup, openWizard])

  async function loadDirectories(share: string, remotePath: string): Promise<void> {
    const requestId = directoryRequestId.current + 1
    directoryRequestId.current = requestId
    setLoadingDirectories(true)
    try {
      const result = await window.luna.nasSync.probe(normalizedConfig({ ...form, share, remotePath }))
      if (requestId !== directoryRequestId.current) return
      if (!result.ok) {
        toast.error(result.message ?? 'NAS 连接失败')
        setDirectoryOptions([])
        return
      }
      setDirectoryOptions(result.directories ?? [])
    } catch (error) {
      if (requestId !== directoryRequestId.current) return
      setDirectoryOptions([])
      toast.error(error instanceof Error ? error.message : 'NAS 连接失败')
    } finally {
      if (requestId === directoryRequestId.current) setLoadingDirectories(false)
    }
  }

  async function continueToDirectory(): Promise<void> {
    if (!connectionReady || !validPort) {
      toast.error('请填写服务器地址和端口')
      return
    }
    setBusy(true)
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
      setShareOptions(shares)
      setSelectedShare('')
      setSelectedDirectory('')
      setDirectoryOptions([])
      setStep('directory')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'NAS 连接失败')
    } finally {
      setBusy(false)
    }
  }

  async function openShare(share: string): Promise<void> {
    setSelectedShare(share)
    setSelectedDirectory('/')
    await loadDirectories(share, '/')
  }

  async function openDirectory(directory: string): Promise<void> {
    if (!selectedShare) return
    const next = joinDirectory(selectedDirectory, directory)
    setSelectedDirectory(next)
    await loadDirectories(selectedShare, next)
  }

  async function goBackDirectory(): Promise<void> {
    if (!selectedShare) return
    if (selectedDirectory === '/') {
      directoryRequestId.current += 1
      setSelectedShare('')
      setSelectedDirectory('')
      setDirectoryOptions([])
      setLoadingDirectories(false)
      return
    }
    const next = parentDirectory(selectedDirectory)
    setSelectedDirectory(next)
    await loadDirectories(selectedShare, next)
  }

  function continueToComplete(): void {
    if (!selectedShare || !selectedDirectory) {
      toast.error('请选择同步目录')
      return
    }
    setForm((current) => ({ ...current, share: selectedShare, remotePath: selectedDirectory }))
    setStep('complete')
  }

  async function saveConfiguration(): Promise<void> {
    const nextConfig = normalizedConfig({
      ...form,
      share: selectedShare,
      remotePath: selectedDirectory,
      enabled: true,
    })
    setBusy(true)
    try {
      const next = await window.luna.saveSettings({ nasSync: nextConfig })
      setSettings(next)
      setForm(configFromSettings(next))
      setWizardOpen(false)
      toast.success('NAS 已配置')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'NAS 配置保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function saveSwitch(patch: Partial<NasSettings>): Promise<void> {
    if (!settings) return
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

  async function syncLocalResources(): Promise<void> {
    if (!form.enabled || !configured) return
    setSyncingLocalResources(true)
    try {
      const result = await window.luna.nasSync.syncLocalResources()
      if (result.queued > 0) showProgress()
      else toast.success('没有新的文件需要同步')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '同步本地资源失败')
    } finally {
      setSyncingLocalResources(false)
    }
  }

  const wizardFooter = step === 'connection'
    ? <><Button variant="secondary" size="compact" onClick={() => closeWizard(false)}>取消</Button><Button variant="primary" size="compact" disabled={busy} icon={<ChevronRight size={14} />} onClick={() => void continueToDirectory()}>{busy ? '连接中' : '下一步'}</Button></>
    : step === 'directory'
      ? <><Button variant="secondary" size="compact" onClick={() => setStep('connection')}>上一步</Button><Button variant="primary" size="compact" disabled={loadingDirectories || !selectedShare || !selectedDirectory} icon={<ChevronRight size={14} />} onClick={continueToComplete}>下一步</Button></>
      : <><Button variant="secondary" size="compact" onClick={() => setStep('directory')}>上一步</Button><Button variant="primary" size="compact" disabled={busy} icon={<Check size={14} />} onClick={() => void saveConfiguration()}>{busy ? '保存中' : '完成配置'}</Button></>

  return (
    <section className="settings-group">
      <h2 className="settings-group-title">NAS 同步</h2>
      <div className="settings-card nas-settings-card">
        {!configured ? (
          <article className="settings-row nas-setup-row">
            <div className="settings-row-copy">
              <span><HardDrive size={15} aria-hidden="true" />NAS 同步</span>
              <em>未配置</em>
            </div>
            <Button variant="primary" size="compact" icon={<FolderCog size={14} />} disabled={!settings} onClick={openWizard}>开始配置</Button>
          </article>
        ) : (
          <>
            <article className="settings-row">
              <div className="settings-row-copy"><span><HardDrive size={15} aria-hidden="true" />同步位置</span><strong>{targetLabel(form)}</strong></div>
              <Button variant="secondary" size="compact" icon={<Settings2 size={14} />} onClick={openWizard}>重新配置</Button>
            </article>
            <article className="settings-row nas-concurrency-row">
              <div className="settings-row-copy"><span>同步并发数量</span><em>同时上传的文件数，范围 1 到 10</em></div>
              <Input
                variant="compact"
                type="number"
                min={1}
                max={10}
                step={1}
                value={form.concurrency}
                aria-label="同步并发数量"
                onChange={(event) => setForm((current) => ({ ...current, concurrency: Number(event.target.value) || 1 }))}
              />
            </article>
            <article className="settings-row">
              <div className="settings-row-copy"><span>启用 NAS 同步</span><em>{form.enabled ? '已启用' : '已暂停'}</em></div>
              <Switch checked={form.enabled} disabled={!settings} ariaLabel="启用 NAS 同步" onCheckedChange={(enabled) => void saveSwitch({ enabled })} />
            </article>
            <article className="settings-row">
              <div className="settings-row-copy"><span>自动同步新下载</span><em>{form.autoSync ? '已开启' : '已关闭'}</em></div>
              <Switch checked={form.autoSync} disabled={!settings || !form.enabled} ariaLabel="自动同步新下载" onCheckedChange={(autoSync) => void saveSwitch({ autoSync })} />
            </article>
            <div className="nas-manual-sync">
              <Button variant="primary" size="compact" disabled={!form.enabled || syncingLocalResources} icon={<FolderSync size={14} />} onClick={() => void syncLocalResources()}>{syncingLocalResources ? '同步中' : '立即同步'}</Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={wizardOpen} onOpenChange={closeWizard} title="配置 NAS 同步" className="nas-setup-dialog" footer={wizardFooter} closeOnMaskClick={!busy}>
        <div className="nas-setup-progress" aria-label={`第 ${step === 'connection' ? 1 : step === 'directory' ? 2 : 3} 步，共 3 步`}>
          <span className={step === 'connection' ? 'is-current' : 'is-complete'}>1</span><i />
          <span className={step === 'directory' ? 'is-current' : step === 'complete' ? 'is-complete' : ''}>2</span><i />
          <span className={step === 'complete' ? 'is-current' : ''}>3</span>
        </div>
        {step === 'connection' && <div className="nas-setup-form"><label><span>SMB 服务器 IP</span><Input variant="compact" fullWidth value={form.server} placeholder="例如 192.168.1.20" onChange={(event) => updateConnection({ server: event.target.value })} /></label><label><span>端口</span><Input variant="compact" type="number" min={1} max={65535} step={1} fullWidth value={form.port} onChange={(event) => updateConnection({ port: Number(event.target.value) || emptyConfig.port })} /></label><label><span>用户名</span><Input variant="compact" fullWidth value={form.username} onChange={(event) => updateConnection({ username: event.target.value })} /></label><label><span>密码</span><Input variant="compact" type="password" fullWidth value={form.password} onChange={(event) => updateConnection({ password: event.target.value })} /></label></div>}
        {step === 'directory' && <div className="nas-directory-picker"><div className="nas-directory-location">{selectedShare && <Tooltip content="返回上一级"><IconButton variant="ghost" size="mini" icon={<ArrowLeft size={16} />} aria-label="返回上一级" onClick={() => void goBackDirectory()} /></Tooltip>}<strong>{selectedShare ? `${selectedShare}${selectedDirectory === '/' ? '' : ` / ${selectedDirectory}`}` : '选择共享目录'}</strong></div><div className="nas-directory-list" aria-busy={loadingDirectories}>{!selectedShare && shareOptions.map((share) => <Button key={share.name} variant="secondary" className="nas-directory-item" onClick={() => void openShare(share.name)}><Folder size={18} /><span>{share.name}</span><ChevronRight size={17} /></Button>)}{selectedShare && !loadingDirectories && directoryOptions.map((directory) => <Button key={directory} variant="secondary" className="nas-directory-item" onClick={() => void openDirectory(directory)}><Folder size={18} /><span>{directory}</span><ChevronRight size={17} /></Button>)}{selectedShare && !loadingDirectories && directoryOptions.length === 0 && <div className="nas-directory-empty">没有子目录</div>}{loadingDirectories && <div className="nas-directory-empty">读取中</div>}</div></div>}
        {step === 'complete' && <div className="nas-setup-complete"><Check size={24} aria-hidden="true" /><strong>确认同步位置</strong><span>{targetLabel({ ...form, share: selectedShare, remotePath: selectedDirectory })}</span></div>}
      </Dialog>
    </section>
  )
}
