import { useRef, useState } from 'react'
import { Check, Clock, Loader2, X } from 'lucide-react'

import type { ExportProgress } from '../shared/types'
import { Dialog, IconButton, Tooltip } from '../ui'
import { ExportTaskTable } from './ExportTaskTable'
import '../styles/download-progress.css'

interface ExportProgressModalProps {
  exportProgress: Map<string, ExportProgress>
  onRevealFile: (path: string) => void
}

export function ExportProgressModal({
  exportProgress,
  onRevealFile,
}: ExportProgressModalProps) {
  const [open, setOpen] = useState(false)
  const [seenCount, setSeenCount] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const entries = [...exportProgress.values()]
  const totalCount = entries.length
  const completedCount = entries.filter((progress) => progress.status === 'done').length
  const failedCount = entries.filter((progress) => progress.status === 'failed').length
  const canceledCount = entries.filter((progress) => progress.status === 'canceled').length
  const activeCount = entries.filter((progress) => progress.status === 'exporting').length
  const queuedCount = entries.filter((progress) => progress.status === 'queued').length

  const descriptionParts: string[] = []
  if (totalCount > 0) descriptionParts.push(`已完成 ${completedCount}/${totalCount}`)
  if (queuedCount > 0) descriptionParts.push(`${queuedCount} 个等待`)
  if (failedCount > 0) descriptionParts.push(`${failedCount} 个失败`)
  if (canceledCount > 0) descriptionParts.push(`${canceledCount} 个已取消`)
  const description = descriptionParts.join('，')

  const icon =
    totalCount === 0 ? <Clock size={15} /> :
    activeCount > 0 ? <Loader2 className="spin" size={14} /> :
    failedCount > 0 || canceledCount > 0 ? <X size={14} /> :
    <Check size={14} />

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <Tooltip content="导出记录">
        <IconButton variant="ghost" icon={icon} onClick={() => setOpen(true)} />
      </Tooltip>
      {completedCount > 0 && completedCount > seenCount && (
        <span className="download-badge-corner">{completedCount}</span>
      )}

      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (value) setSeenCount(completedCount)
        }}
        title="导出记录"
        description={totalCount > 0 ? description : undefined}
        className="et-main-dialog"
      >
        {totalCount > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="dl-overall-track">
              <div className="dl-overall-fill" style={{ width: `${Math.min(100, totalCount > 0 ? (completedCount / totalCount * 100) : 0)}%` }} />
            </div>
          </div>
        )}
        <ExportTaskTable onRevealFile={onRevealFile} />
      </Dialog>
    </div>
  )
}
