import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DirectorLanPlanSummary } from '../shared/types'
import { Button, Dialog, toast } from '../ui'

interface Props {
  plan: DirectorLanPlanSummary
  disabled?: boolean
  onDeleted: (plan: DirectorLanPlanSummary) => void
}

export function DirectorPlanDeleteControl({ plan, disabled, onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  if (!plan.local_directory) return null
  async function remove() {
    if (deleting) return
    setDeleting(true)
    try {
      await window.luna.directorLab.deleteLocalPlan(plan.id, plan.local_content_signature ?? '')
      setOpen(false)
      onDeleted(plan)
      toast.success('计划已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }
  return <>
    <Button variant="danger" size="compact" icon={<Trash2 size={14} />} disabled={disabled || deleting}
      onClick={() => setOpen(true)}>删除计划</Button>
    <Dialog open={open} onOpenChange={value => { if (!deleting) setOpen(value) }} title="删除计划"
      description={`将“${plan.title}”及本地素材移到废纸篓？手机上的计划保留。`}
      footer={<><Button disabled={deleting} onClick={() => setOpen(false)}>取消</Button>
        <Button variant="danger" disabled={deleting} onClick={() => void remove()}>{deleting ? '删除中' : '删除'}</Button></>} />
  </>
}
