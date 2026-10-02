import { useRef, useState } from 'react'
import type { DirectorLanPlanSummary } from '../shared/types'
import { directorPlanContentSignature } from '../lib/directorPlanSync'
import { Alert, Button, Dialog, toast } from '../ui'
import './DirectorPlanMainContentDialog.css'

interface DirectorPlanMainContentProps {
  plan: DirectorLanPlanSummary
  onSaved: (plan: DirectorLanPlanSummary) => void
  onWriteStateChange: (planId: string, pending: boolean) => void
  refreshPlans: () => Promise<DirectorLanPlanSummary[]>
}

export function DirectorPlanMainContent({ plan, onSaved, onWriteStateChange, refreshPlans }: DirectorPlanMainContentProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const baseline = useRef({ plan, signature: directorPlanContentSignature(plan) })
  const busy = useRef(false)
  const dirty = draft !== (baseline.current.plan.main_content ?? '')

  const changeOpen = (next: boolean) => {
    if (busy.current) return
    if (!next && dirty) { setConfirmClose(true); return }
    if (next) {
      baseline.current = { plan, signature: plan.local_content_signature ?? directorPlanContentSignature(plan) }
      setDraft(plan.main_content ?? '')
      setError(null)
    }
    setOpen(next)
  }

  const save = async () => {
    if (busy.current || !dirty) return
    busy.current = true
    setSaving(true)
    setError(null)
    const current = baseline.current
    onWriteStateChange(current.plan.id, true)
    try {
      const saved = await window.luna.directorLab.saveLocalPlan({ ...current.plan, main_content: draft,
        synced_signature: current.plan.synced_signature ?? directorPlanContentSignature(current.plan) }, current.signature)
      onSaved(saved)
      setOpen(false)
      toast.success('主要内容已保存')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败'
      if (message.includes('HTTP 409') || message.includes('其他端修改') || message.includes('计划已更新')) {
        try {
          const latest = (await refreshPlans()).find(item => item.id === current.plan.id)
          if (!latest) throw new Error('计划不存在')
          baseline.current = { plan: latest, signature: latest.local_content_signature ?? directorPlanContentSignature(latest) }
          setError('计划已更新，请确认内容后再次保存')
        } catch { setError('刷新失败，请重试') }
      } else setError(message)
    } finally {
      onWriteStateChange(current.plan.id, false)
      busy.current = false
      setSaving(false)
    }
  }

  return <>
    <Dialog open={open} onOpenChange={changeOpen} title="主要内容" className="director-main-content-dialog"
      closeOnMaskClick={!saving} showCloseButton={!saving}
      trigger={<Button variant="ghost" size="mini">主要内容</Button>}
      footer={<><Button size="compact" disabled={saving} onClick={() => changeOpen(false)}>取消</Button>
        <Button variant="primary" size="compact" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中' : '保存'}</Button></>}>
      <textarea className="ui-input ui-input-compact director-main-content-input" aria-label="主要内容" autoFocus
        value={draft} disabled={saving} onChange={event => { setDraft(event.target.value); setError(null) }} />
      {error && <div role="alert"><Alert variant="error" message={error} /></div>}
    </Dialog>
    <Dialog open={confirmClose} onOpenChange={setConfirmClose} title="放弃未保存的修改？"
      footer={<><Button size="compact" onClick={() => setConfirmClose(false)}>继续编辑</Button>
        <Button variant="danger" size="compact" onClick={() => { setConfirmClose(false); setOpen(false) }}>放弃</Button></>} />
  </>
}
