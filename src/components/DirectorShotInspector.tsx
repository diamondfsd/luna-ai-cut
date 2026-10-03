import { useState, type ReactNode } from 'react'
import { Clock3 } from 'lucide-react'
import type { DirectorLanShot, DirectorLanTake } from '../shared/types'
import { normalizeDirectorShotFields } from '../lib/directorShotFields'
import { DirectorTakeList } from './DirectorTakeList'
import { Button, Dialog, toast } from '../ui'
import './DirectorMediaPreviewDialog.css'

interface Props {
  shot: DirectorLanShot
  takes: DirectorLanTake[]
  selectedId?: string
  disabled?: boolean
  onSelect: (take: DirectorLanTake) => void
  onAddMaterials: () => void
  onDeleteMaterial?: (take: DirectorLanTake) => Promise<void>
  children?: ReactNode
  markerPanel?: ReactNode
}

export function DirectorShotInspector({ shot, takes, selectedId = '', disabled, onSelect, onAddMaterials, onDeleteMaterial, children, markerPanel }: Props) {
  const [deleteCandidate, setDeleteCandidate] = useState<DirectorLanTake | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deleteMaterial = async () => {
    if (!deleteCandidate || !onDeleteMaterial || deleting) return
    setDeleting(true)
    try { await onDeleteMaterial(deleteCandidate); setDeleteCandidate(null) }
    catch (error) { toast.error(error instanceof Error ? error.message : '删除素材失败') }
    finally { setDeleting(false) }
  }
  const fields = normalizeDirectorShotFields(shot)
  return <><aside className="lab-director-inspector" aria-label="镜头信息">
    <div className="lab-viewer-shot-heading"><span>镜头 {shot.order}</span><h3>{shot.name}</h3></div>
    <div className="lab-viewer-shot-duration"><Clock3 size={14} /><span>建议时长 {shot.duration_ms / 1000} 秒</span></div>
    {fields.attributes.map(field => <section className="lab-viewer-shot-section" key={field.id}>
      <span>{field.name}</span><p>{field.description}</p>
    </section>)}
    {fields.remark && <section className="lab-viewer-shot-section"><span>备注</span><p>{fields.remark}</p></section>}
    {markerPanel}
    <DirectorTakeList takes={takes} selectedId={selectedId} disabled={disabled || deleting} onSelect={onSelect} onAddMaterials={onAddMaterials}
      onDelete={onDeleteMaterial ? setDeleteCandidate : undefined} />
    {children}
  </aside>
    <Dialog open={Boolean(deleteCandidate)} title="删除本地素材？" tone="dark" onOpenChange={open => !open && !deleting && setDeleteCandidate(null)}
      description="确认后将删除本地素材文件，无法还原。手机端原素材不受影响。" showCloseButton={!deleting}
      footer={<><Button disabled={deleting} onClick={() => setDeleteCandidate(null)}>取消</Button>
        <Button variant="danger" disabled={deleting} onClick={() => void deleteMaterial()}>{deleting ? '删除中' : '删除'}</Button></>} />
  </>
}
