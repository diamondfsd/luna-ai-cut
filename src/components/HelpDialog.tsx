import { useState } from 'react'
import type { ReactNode } from 'react'
import { Code2, FileText, HelpCircle, Loader2 } from 'lucide-react'

import type { UpdateInfo } from '../shared/types'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'

interface HelpDialogProps {
  children?: ReactNode
}

export function HelpDialog({ children }: HelpDialogProps) {
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [noUpdate, setNoUpdate] = useState(false)
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false)

  async function handleCheckUpdate(): Promise<void> {
    setChecking(true)
    setNoUpdate(false)
    setUpdateInfo(null)
    try {
      const info = await window.luna.checkForUpdates()
      if (info) {
        setUpdateInfo(info)
      } else {
        setNoUpdate(true)
      }
    } catch {
      setNoUpdate(true)
    } finally {
      setChecking(false)
    }
  }

  function handleDownload(): void {
    const url = updateInfo?.downloadUrl || updateInfo?.releaseUrl
    if (url) void window.luna.openPath(url)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children ?? (
          <button className="nav-icon-button" title="帮助与反馈">
            <HelpCircle size={15} />
          </button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>帮助与反馈</DialogTitle>
          <DialogDescription>有疑问或需要帮助？扫码关注我的抖音加入讨论群</DialogDescription>
        </DialogHeader>
        <div className="help-dialog-body">

          {/* 版本与更新 */}
          <div className="help-section">
            <div className="help-version-row">
              <span className="help-version-text">v{__APP_VERSION__}</span>
              {updateInfo ? (
                <span className="help-update-available">
                  <span>新版本 <strong>v{updateInfo.version}</strong> 可用</span>
                  <Button variant="primary" size="compact" onClick={handleDownload}>
                    下载更新
                  </Button>
                </span>
              ) : noUpdate ? (
                <span className="help-no-update">已是最新版本</span>
              ) : (
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => void handleCheckUpdate()}
                  disabled={checking}
                  icon={checking ? <Loader2 className="spin" size={14} /> : undefined}
                >
                  {checking ? '检查中...' : '检查更新'}
                </Button>
              )}
            </div>
            <button className="help-link-btn" onClick={() => setReleaseNotesOpen(true)}>
              <FileText size={14} />
              <span>更新说明</span>
              <small>查看各版本变更内容</small>
            </button>
          </div>

          {/* 关注与反馈 */}
          <div className="help-section">
            <img
              src="./my-douyin-qr-code.jpg"
              alt="抖音二维码"
              className="help-qr-code"
            />
            <p className="help-qr-tip">
              打开抖音扫码关注，获取更多使用技巧和帮助
            </p>
          </div>

          {/* 资源链接 */}
          <div className="help-section help-links-row">
            <a className="help-link-btn" href="#" onClick={(e) => { e.preventDefault(); void window.luna.openPath('https://diamondfsd.github.io/luna-ai-cut/') }}>
              <span>官方网站</span>
            </a>
            <button className="help-devtools-btn" onClick={() => void window.luna.openDevTools()} title="开发者工具">
              <Code2 size={13} />
              <span>开发者工具</span>
            </button>
          </div>

        </div>
      </DialogContent>
      <ReleaseNotesDialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen} />
    </Dialog>
  )
}
