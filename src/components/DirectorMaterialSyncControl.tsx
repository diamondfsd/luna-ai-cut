import { useState } from 'react'
import type { DirectorMaterialSyncProgress } from '../shared/types'
import { Button, Dialog, ProgressBar, Switch } from '../ui'
import './DirectorMaterialSyncControl.css'

function filePercent(item: DirectorMaterialSyncProgress): number {
  if (item.status === 'done') return 100
  return item.total && item.total > 0 ? Math.min(99, Math.floor(item.transferred / item.total * 100)) : 0
}

function fileStatus(item: DirectorMaterialSyncProgress): string {
  if (item.status === 'failed') return '同步失败'
  if (item.status === 'done') return '已同步'
  if (item.status === 'pending') return '等待同步'
  return `${item.direction === 'upload' ? '发送到手机' : '下载到电脑'} ${filePercent(item)}%`
}

interface Props {
  enabled: boolean
  onEnabledChange: (checked: boolean) => void
  progress: DirectorMaterialSyncProgress[]
}

export function DirectorMaterialSyncControl({ enabled, onEnabledChange, progress }: Props) {
  const [open, setOpen] = useState(false)
  const failed = progress.some(item => item.status === 'failed')
  const completed = progress.filter(item => item.status === 'done').length
  const percent = progress.length ? Math.floor(progress.reduce((total, item) => total + filePercent(item), 0) / progress.length) : 0
  return <>
    <div className="director-material-sync-control">
      <label className="director-material-sync-toggle"><span>同步素材</span>
        <Switch checked={enabled} ariaLabel="同步素材" onCheckedChange={onEnabledChange} />
      </label>
      {enabled && progress.length > 0 && <Button size="mini" variant="ghost" onClick={() => setOpen(true)}>
        {failed ? '同步失败' : completed === progress.length ? '已同步' : `同步中 ${percent}%`}
      </Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen} title="素材同步" bodyClassName="director-material-sync-body">
      {progress.length === 0 ? <span>暂无同步任务</span> : <>
        <div className="director-material-sync-summary"><span>{completed}/{progress.length} 个素材</span><span>{percent}%</span></div>
        <ProgressBar value={percent} ariaLabel="素材同步总进度" />
        {progress.map(item => <div className="director-material-sync-file" key={`${item.planId}:${item.takeId}:${item.direction}`}>
          <div><span className="director-material-sync-name">{item.fileName}</span><span>{fileStatus(item)}</span></div>
          <ProgressBar value={filePercent(item)} ariaLabel={`${item.fileName}同步进度`} />
        </div>)}
      </>}
    </Dialog>
  </>
}
