import { Button, Dialog } from '../ui'
import type { ExternalDownloadDirectoryDecision } from '../pages/useMediaLibraryTransferActions'

interface ExternalDownloadDirectoryDialogProps {
  open: boolean
  onDecision: (decision: ExternalDownloadDirectoryDecision) => void
}

export function ExternalDownloadDirectoryDialog({ open, onDecision }: ExternalDownloadDirectoryDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDecision('cancel')
      }}
      title="下载目录提示"
      description="当前选择的目录不是设置中的下载目录"
      footer={(
        <>
          <Button variant="secondary" onClick={() => onDecision('reselect')}>
            重新选择目录
          </Button>
          <Button variant="primary" onClick={() => onDecision('confirm')}>
            确认下载
          </Button>
        </>
      )}
    >
      <div className="ui-dialog-body">
        下载到外部目录后，将无法在本地资源中预览。
      </div>
    </Dialog>
  )
}
