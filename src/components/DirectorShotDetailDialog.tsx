import { useState } from 'react'
import type { DirectorLanPlanSummary, DirectorLanShot } from '../shared/types'
import { DirectorMediaPreviewDialog } from './DirectorMediaPreviewDialog'

interface Props {
  shot: DirectorLanShot | null
  plan: DirectorLanPlanSummary
  onLocalPlanChange: (plan: DirectorLanPlanSummary) => void
  onWriteStateChange: (planId: string, pending: boolean) => void
  phoneConnected: boolean
  onClose: () => void
}

export function DirectorShotDetailDialog({ shot, plan, onLocalPlanChange, onWriteStateChange, phoneConnected, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!shot) return null
  const selected = shot.takes.find(take => take.id === selectedId && take.available && take.stream_url)
    ?? shot.takes.find(take => take.available && take.stream_url) ?? null
  return <DirectorMediaPreviewDialog plan={plan} shot={shot} takes={shot.takes} take={selected}
    planTitle={plan.title} phoneConnected={phoneConnected} downloading={false} onDownload={() => undefined}
    onLocalPlanChange={onLocalPlanChange} onWriteStateChange={onWriteStateChange}
    onSelectTake={take => setSelectedId(take.id)} onClose={onClose} />
}
