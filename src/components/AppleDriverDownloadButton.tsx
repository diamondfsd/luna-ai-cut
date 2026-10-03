import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button, toast } from '../ui'
import type { AppleDriverDownloadStatus } from '../shared/types'
import './AppleDriverDownloadButton.css'

export function AppleDriverDownloadButton({ status }: { status: AppleDriverDownloadStatus }) {
  const [busy, setBusy] = useState(false)
  const downloading = status.state === 'downloading'
  const progress = Math.min(100, Math.floor(status.completedBytes / Math.max(1, status.totalBytes) * 100))
  const pending = busy || downloading || status.state === 'verifying' || status.state === 'opening'
  const label = downloading ? `下载中 ${progress}%`
    : status.state === 'verifying' ? '正在验证'
      : status.state === 'opening' ? '正在打开'
        : status.state === 'opened' ? '打开安装程序' : '下载驱动'

  const install = async () => {
    if (pending) return
    setBusy(true)
    try {
      await window.luna.liveStream.installAppleDriver()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '驱动安装失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="apple-driver-download">
      <Button variant="primary" size="compact" icon={<Download size={15} />} onClick={() => void install()} disabled={pending}>
        {label}
      </Button>
    </div>
  )
}
