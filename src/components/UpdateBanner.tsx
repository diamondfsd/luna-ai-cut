import { useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import type { UpdateInfo } from '../shared/types'
import { Button } from '../ui/Button'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'

interface UpdateBannerProps {
  updateInfo?: UpdateInfo | null
}

export function UpdateBanner({ updateInfo = null }: UpdateBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)

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
