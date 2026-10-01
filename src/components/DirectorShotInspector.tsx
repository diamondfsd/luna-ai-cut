import type { ReactNode } from 'react'
import { Clock3 } from 'lucide-react'
import type { DirectorLanShot, DirectorLanTake } from '../shared/types'
import { normalizeDirectorShotFields } from '../lib/directorShotFields'
import { DirectorTakeList } from './DirectorTakeList'
import './DirectorMediaPreviewDialog.css'

interface Props {
  shot: DirectorLanShot
  takes: DirectorLanTake[]
  selectedId?: string
  disabled?: boolean
  onSelect: (take: DirectorLanTake) => void
  onAddMaterials: () => void
  children?: ReactNode
}

export function DirectorShotInspector({ shot, takes, selectedId = '', disabled, onSelect, onAddMaterials, children }: Props) {
  const fields = normalizeDirectorShotFields(shot)
  return <aside className="lab-director-inspector" aria-label="镜头信息">
    <div className="lab-viewer-shot-heading"><span>镜头 {shot.order}</span><h3>{shot.name}</h3></div>
    <div className="lab-viewer-shot-duration"><Clock3 size={14} /><span>建议时长 {shot.duration_ms / 1000} 秒</span></div>
    {fields.attributes.map(field => <section className="lab-viewer-shot-section" key={field.id}>
      <span>{field.name}</span><p>{field.description}</p>
    </section>)}
    {fields.remark && <section className="lab-viewer-shot-section"><span>备注</span><p>{fields.remark}</p></section>}
    <DirectorTakeList takes={takes} selectedId={selectedId} disabled={disabled} onSelect={onSelect} onAddMaterials={onAddMaterials} />
    {children}
  </aside>
}
