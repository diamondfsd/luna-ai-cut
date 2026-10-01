import { Upload } from 'lucide-react'
import type { DirectorLanShot, DirectorLanTake } from '../shared/types'
import { Button, Dialog } from '../ui'
import { DirectorShotInspector } from './DirectorShotInspector'
import './DirectorVideoRangeEditor.css'
import './DirectorShotDetailDialog.css'

interface Props {
  shot: DirectorLanShot | null
  adding: boolean
  phoneConnected: boolean
  onClose: () => void
  onAddMaterials: (shot: DirectorLanShot) => void
  onOpenTake: (take: DirectorLanTake) => void
}

export function DirectorShotDetailDialog({ shot, adding, phoneConnected, onClose, onAddMaterials, onOpenTake }: Props) {
  return <Dialog open={shot !== null} title={shot ? `${String(shot.order).padStart(2, '0')} · ${shot.name}` : '拍摄详情'}
    tone="dark" className="director-range-dialog" bodyClassName="director-range-body"
    onOpenChange={open => !open && onClose()} closeOnMaskClick={false}>
    {shot && <>
      <div className="director-range-main">
      <div className="director-range-preview lab-shot-empty-preview">
        <Button variant="primary" icon={<Upload size={18} />} disabled={adding}
          onClick={() => onAddMaterials(shot)}>{adding ? '添加中' : '添加素材'}</Button>
        {!phoneConnected && !shot.takes.some(take => take.available && take.stream_url?.startsWith('file:'))
          ? <p role="status">手机未连接，且本地没有可用素材。请连接手机同步素材，或添加本地素材。</p>
          : shot.takes.length > 0 && <p role="status">素材不可用，请连接手机同步素材，或添加本地素材。</p>}
      </div>
      </div>
      <DirectorShotInspector shot={shot} takes={shot.takes} disabled={adding}
        onAddMaterials={() => onAddMaterials(shot)}
        onSelect={take => { onClose(); onOpenTake(take) }} />
    </>}
  </Dialog>
}
