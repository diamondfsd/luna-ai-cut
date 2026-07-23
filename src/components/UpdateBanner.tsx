import { useEffect, useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import type { UpdateInfo } from '../shared/types'
import { Button } from '../ui/Button'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'

interface UpdateBannerProps {
  onCheck?: (info: UpdateInfo | null) => void
}

export function UpdateBanner({ onCheck }: UpdateBannerProps) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

  useEffect(() => {
    // 启动时主动检查
    void window.luna.checkForUpdates().then((info) => {
      if (info) {
        setUpdateInfo(info)
        onCheck?.(info)
      }
    })

    // 监听主进程推送的更新通知
    const unsub = window.luna.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      onCheck?.(info)
    })

    return unsub
  }, [onCheck])

  if (!updateInfo || dismissed) return null

  function handleDownload(): void {
    const info = updateInfo
    if (!info) return
    const url = info.downloadUrl || info.releaseUrl
    if (url) void window.luna.openPath(url)
  }

  return (
    <>
      <div className="update-banner">
        <span className="update-banner-text">
          🎉 新版本 <strong>v{updateInfo.version}</strong> 可用
        </span>
        <div className="update-banner-actions">
          <Button variant="secondary" size="compact" onClick={() => setShowReleaseNotes(true)}>
            <FileText size={14} />
            更新内容
          </Button>
          <Button variant="primary" size="compact" onClick={handleDownload}>
            <ExternalLink size={14} />
            下载更新
          </Button>
          <button className="update-banner-close" onClick={() => setDismissed(true)} aria-label="关闭">
            ✕
          </button>
        </div>
      </div>
      <ReleaseNotesDialog
        open={showReleaseNotes}
        onOpenChange={setShowReleaseNotes}
        latestVersion={updateInfo.version}
        latestReleaseNotes={updateInfo.releaseNotes}
      />
    </>
  )
}
