import { useCallback, useState } from 'react'
import type { DirectorLabDownloadProgress, DirectorLanPlanSummary, DirectorLanShot, DirectorLanTake } from '../shared/types'
import { toast } from '../ui'
import { DirectorVideoRangeEditor } from './DirectorVideoRangeEditor'
import { directorPreviewPath } from '../lib/directorMediaSource'
import { directorPlanWithTakeRange, type DirectorTakeRange } from '../lib/directorTakeRange'
import { directorPlanContentSignature } from '../lib/directorPlanSync'
import './DirectorMediaPreviewDialog.css'

interface DirectorMediaPreviewDialogProps {
  plan: DirectorLanPlanSummary
  onLocalPlanChange: (plan: DirectorLanPlanSummary) => void
  onWriteStateChange: (planId: string, pending: boolean) => void
  take: DirectorLanTake
  shot: DirectorLanShot
  takes: DirectorLanTake[]
  planTitle: string
  phoneConnected: boolean
  downloading: boolean
  downloadProgress?: DirectorLabDownloadProgress | null
  onSelectTake: (take: DirectorLanTake) => void
  onDownload: (take: DirectorLanTake) => void
  onClose: () => void
}

function mediaPath(take: DirectorLanTake): string {
  const url = new URL(take.stream_url!)
  if (url.protocol !== 'file:') url.searchParams.set('path', take.file_name)
  return url.toString()
}

export function DirectorMediaPreviewDialog({ plan, onLocalPlanChange, onWriteStateChange, take, shot, takes, phoneConnected,
  onSelectTake, onClose }: DirectorMediaPreviewDialogProps) {
  const [adding, setAdding] = useState(false)
  const addMaterials = async () => {
    if (adding) return
    setAdding(true)
    onWriteStateChange(plan.id, true)
    try {
      const saved = await window.luna.directorLab.importMaterials(plan, shot.id)
      if (saved) onLocalPlanChange(saved)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加素材失败')
    } finally {
      setAdding(false)
      onWriteStateChange(plan.id, false)
    }
  }
  const source = useCallback(async () => {
    if (!take.stream_url || !take.available) throw new Error('素材不可用')
    const url = take.kind !== 'video' || take.stream_url.startsWith('file:') ? mediaPath(take)
      : (await window.luna.directorLab.preparePreview({ url: take.stream_url, cacheKey: take.stream_url })).url
    return directorPreviewPath(url)
  }, [take])
  const saveRange = async (range: DirectorTakeRange) => {
    const expected = plan.local_content_signature ?? directorPlanContentSignature(plan)
    const next = directorPlanWithTakeRange(plan, take.id, range)
    onWriteStateChange(plan.id, true)
    try {
      const saved = await window.luna.directorLab.saveLocalPlan({ ...next,
        synced_signature: plan.synced_signature ?? directorPlanContentSignature(plan),
      }, expected)
      onLocalPlanChange(saved)
    } finally { onWriteStateChange(plan.id, false) }
  }
  return <DirectorVideoRangeEditor take={take} shot={shot} takes={takes} source={source}
    onSave={saveRange} onSelectTake={onSelectTake} onClose={onClose} phoneConnected={phoneConnected}
    adding={adding} onAddMaterials={() => void addMaterials()} />
}
