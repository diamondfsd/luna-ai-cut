import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Code2, ExternalLink, FileText, HelpCircle, Loader2, RefreshCw, Trash2, Zap, X as XIcon } from 'lucide-react'

import type { HotUpdateCheckResult, UpdateInfo } from '../shared/types'
import { Button, Dialog } from '../ui'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'
import douyinQrCode from '../../public/my-douyin-qr-code.jpg'
import './HelpDialog.css'

interface HelpDialogProps {
  children?: ReactNode
}

export function HelpDialog({ children }: HelpDialogProps) {
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [noUpdate, setNoUpdate] = useState(false)
  const [hotVersion, setHotVersion] = useState<string | null>(null)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  // 热更新状态
  const [hotUpdateCheck, setHotUpdateCheck] = useState<HotUpdateCheckResult | null>(null)
  const [hotPhase, setHotPhase] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle')
  const [hotError, setHotError] = useState<string | null>(null)
  const [showHotNotes, setShowHotNotes] = useState(false)

  useEffect(() => {
    window.luna.getHotUpdateVersion().then(v => setHotVersion(v)).catch(() => {})
    window.luna.checkForHotUpdates()
      .then(result => { if (result) setHotUpdateCheck(result) })
      .catch(() => {})
    checkForUpdatesSilently()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkForUpdatesSilently(): Promise<void> {
    try {
      const info = await window.luna.checkForUpdates()
      if (info) setUpdateInfo(info)
      else setNoUpdate(true)
    } catch { setNoUpdate(true) }
  }

  async function handleCheckUpdate(): Promise<void> {
    setChecking(true)
    setNoUpdate(false)
    setUpdateInfo(null)
    try {
      const info = await window.luna.checkForUpdates()
      if (info) setUpdateInfo(info)
      else setNoUpdate(true)
    } catch { setNoUpdate(true) }
    finally { setChecking(false) }
  }

  function handleDownload(): void {
    const url = updateInfo?.downloadUrl || updateInfo?.releaseUrl
    if (url) void window.luna.openPath(url)
  }

  async function handleApplyHotUpdate(): Promise<void> {
    if (!hotUpdateCheck) return
    setHotPhase('downloading')
    setHotError(null)
    try {
      const result = await window.luna.applyHotUpdate(hotUpdateCheck)
      if (result.success) setHotPhase('ready')
      else { setHotError(result.error ?? '应用失败'); setHotPhase('error') }
    } catch (err) {
      setHotError(err instanceof Error ? err.message : String(err))
      setHotPhase('error')
    }
  }

  function handleRelaunch(): void {
    void window.luna.relaunchApp()
  }

  async function handleDeleteHotUpdate(): Promise<void> {
    try { await window.luna.clearHotUpdate() } catch { /* ignore */ }
    setHotVersion(null)
    window.luna.checkForHotUpdates()
      .then(result => { if (result) setHotUpdateCheck(result) })
      .catch(() => {})
  }

  return (
    <>
      <Dialog
        trigger={children ?? (
          <button className="nav-icon-button" title="帮助与反馈">
            <HelpCircle size={15} />
          </button>
        )}
        title="帮助与反馈"
        description="有疑问或需要帮助？扫码关注抖音，获取使用技巧和问题反馈支持。"
        className="help-dialog-content"
      >
        <div className="help-dialog-body">
          <div className="help-dialog-main">
            <div className="help-dialog-summary">
              <section className="help-version-section">
                <span className="help-section-label">版本信息</span>
                <div className="help-version-row">
                  <span className="help-version">
                    v{__APP_VERSION__}
                    {hotVersion && (
                      <span className="help-hot-badge">
                        <Zap size={11} />
                        {hotVersion.split('-').pop()}
                        <button className="help-hot-delete" onClick={() => void handleDeleteHotUpdate()} title="删除当前热更新（用于测试）">
                          <Trash2 size={12} />
                        </button>
                      </span>
                    )}
                  </span>
                  {updateInfo ? (
                    <span className="help-version-status">
                      <span className="help-status-dot" />
                      新版本 <strong>v{updateInfo.version}</strong> 可用
                    </span>
                  ) : noUpdate ? (
                    <span className="help-version-status muted">已是最新版本</span>
                  ) : checking ? (
                    <span className="help-version-status muted">
                      <Loader2 size={12} className="spin" />
                      检查中
                    </span>
                  ) : null}
                </div>
                <div className="help-version-actions">
                  {updateInfo && (
                    <Button variant="primary" size="compact" onClick={handleDownload}>
                      <ExternalLink size={14} />
                      下载更新
                    </Button>
                  )}
                  {!checking && (
                    <Button variant="ghost" size="mini" onClick={() => void handleCheckUpdate()} title="手动检查更新">
                      <RefreshCw size={12} />
                      检查更新
                    </Button>
                  )}
                </div>
              </section>

              {hotUpdateCheck && hotPhase !== 'ready' && hotPhase !== 'error' && (
                <div className="help-hot-section">
                  <span className="help-hot-text">
                    <Zap size={14} />
                    {hotPhase === 'downloading'
                      ? '正在下载热更新...'
                      : <>热更新 <strong>v{hotUpdateCheck.version}</strong> 可用</>
                    }
                  </span>
                  <div className="help-hot-actions">
                    {hotPhase === 'idle' && (
                      <>
                        {hotUpdateCheck.notes && (
                          <Button variant="ghost" size="mini" onClick={() => setShowHotNotes(true)}>更新内容</Button>
                        )}
                        <Button variant="primary" size="compact" onClick={() => void handleApplyHotUpdate()}>立即更新</Button>
                      </>
                    )}
                    {hotPhase === 'downloading' && (
                      <span className="help-hot-downloading"><RefreshCw size={14} className="spin" /> 下载中...</span>
                    )}
                  </div>
                </div>
              )}
              {hotPhase === 'ready' && (
                <div className="help-hot-section">
                  <span className="help-hot-text"><Zap size={14} /> 热更新已就绪，重启后生效</span>
                  <Button variant="primary" size="compact" onClick={handleRelaunch}>立即重启</Button>
                </div>
              )}
              {hotPhase === 'error' && (
                <div className="help-hot-section error">
                  <span className="help-hot-text">热更新失败：{hotError}</span>
                  <Button variant="secondary" size="compact" onClick={() => void handleApplyHotUpdate()}>重试</Button>
                </div>
              )}

              <div className="help-notes-section">
                <div className="help-notes-copy">
                  <FileText size={16} />
                  <span>
                    <strong>更新说明</strong>
                    <small>查看各版本变更内容</small>
                  </span>
                </div>
                <Button variant="secondary" size="compact" onClick={() => setReleaseNotesOpen(true)}>
                  查看
                </Button>
              </div>
            </div>

            <aside className="help-douyin-section">
              <span className="help-section-label">关注抖音</span>
              <img src={douyinQrCode} alt="抖音二维码" className="help-qr-code" />
              <p className="help-douyin-desc">获取使用技巧、问题反馈和更新动态</p>
              <span className="help-douyin-id">抖音号：62542925</span>
            </aside>
          </div>

          <div className="help-footer-actions">
            <Button variant="secondary" size="compact" className="help-footer-btn" onClick={() => void window.luna.openPath('https://luna.diamondfsd.com/')}>
              <ExternalLink size={14} />
              官方网站
            </Button>
            <Button variant="secondary" size="compact" className="help-footer-btn" onClick={() => void window.luna.openDevTools()}>
              <Code2 size={14} />
              开发者工具
            </Button>
          </div>
        </div>
      </Dialog>
      <ReleaseNotesDialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen} />

      {/* 热更新内容详情弹窗 */}
      {showHotNotes && hotUpdateCheck?.notes && (
        <div className="update-notes-overlay" onClick={() => setShowHotNotes(false)}>
          <div className="update-notes-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="update-notes-header">
              <h3>更新内容 · v{hotUpdateCheck.version}</h3>
              <button className="update-banner-close" onClick={() => setShowHotNotes(false)} aria-label="关闭"><XIcon size={16} /></button>
            </div>
            <div className="update-notes-body">
              {hotUpdateCheck.notes.split('\n').map((line, i) => (
                <p key={i} className={line.startsWith('#') ? 'notes-heading' : line.startsWith('-') ? 'notes-item' : ''}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
