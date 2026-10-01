import { Upload } from 'lucide-react'
import type { DirectorLanShot, DirectorLanTake } from '../shared/types'
import { Button, Dialog } from '../ui'
import { normalizeDirectorShotFields } from '../lib/directorShotFields'
import { DirectorMediaThumbnail } from './DirectorMediaThumbnail'
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
  const fields = shot ? normalizeDirectorShotFields(shot) : null
  return <Dialog open={shot !== null} title={shot ? `${String(shot.order).padStart(2, '0')} · ${shot.name}` : '拍摄详情'}
    className="lab-shot-detail-dialog" onOpenChange={(open) => !open && !adding && onClose()}
    showCloseButton={!adding} closeOnMaskClick={!adding}
    footer={<Button variant="primary" icon={<Upload size={15} />} disabled={adding || !shot}
      onClick={() => shot && onAddMaterials(shot)}>{adding ? '添加中' : '添加素材'}</Button>}>
    {shot && <div className="lab-shot-detail">
      <dl className="lab-shot-detail-fields">
        <div><dt>时长</dt><dd>{shot.duration_ms / 1000} 秒</dd></div>
        {fields?.attributes.map((field) => <div key={field.id}><dt>{field.name}</dt><dd>{field.description}</dd></div>)}
        {fields?.remark && <div><dt>备注</dt><dd>{fields.remark}</dd></div>}
      </dl>
      <div className="lab-shot-detail-materials">
        {!phoneConnected && !shot.takes.some(take => take.available && take.stream_url?.startsWith('file:'))
          ? <p role="status">手机未连接，且本地没有可用素材。请连接手机同步素材，或添加本地素材。</p>
          : shot.takes.length === 0 && <p role="status">这个镜头还没有素材，请添加素材。</p>}
        {shot.takes.map((take) => <Button key={take.id} variant="utility" disabled={!take.available || !take.stream_url}
          onClick={() => { onClose(); onOpenTake(take) }}>
          {take.stream_url && <DirectorMediaThumbnail url={take.stream_url} />}
          <span>{take.file_name || (take.kind === 'video' ? '视频' : '照片')}</span>
          {take.selected_range && <span>{(take.selected_range.start_ms / 1000).toFixed(1)}–{(take.selected_range.end_ms / 1000).toFixed(1)} 秒</span>}
          {take.selected_range?.note && <span>{take.selected_range.note}</span>}
        </Button>)}
      </div>
    </div>}
  </Dialog>
}
