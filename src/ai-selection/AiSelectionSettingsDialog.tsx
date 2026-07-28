import { useState } from 'react'

import type { AiSelectionPurpose, AiSelectionTarget } from '../shared/types'
import { Button, ButtonGroup, Dialog, Input, Select } from '../ui'
import type { useAiSelection } from './useAiSelection'

export function AiSelectionSettingsDialog({ open, onOpenChange, selection }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selection: ReturnType<typeof useAiSelection>
}) {
  const { session, preset, setPreset, purpose, setPurpose, target, setTarget, controls } = selection
  const [targetValue, setTargetValue] = useState(String(target.value ? target.mode === 'ratio' ? target.value * 100 : target.value : ''))
  if (!session) return null

  function updateTarget(mode: AiSelectionTarget['mode'], raw = targetValue): void {
    const value = mode === 'preset' ? null : mode === 'ratio' ? Number(raw || 0) / 100 : Number(raw || 0)
    const next = { mode, value } as AiSelectionTarget
    setTarget(next)
    void controls.apply({ type: 'set-target', target: next })
  }

  return <Dialog open={open} onOpenChange={onOpenChange} title="选片设置" className="ai-selection-settings-dialog" footer={<Button variant="primary" onClick={() => onOpenChange(false)}>完成</Button>}><div className="ai-selection-settings-body">
    <label><span>选片重点</span><Select variant="compact" fullWidth value={session.purpose ?? purpose} options={[{ value: 'general', label: '快速精选' }, { value: 'people', label: '人物照片' }, { value: 'travel', label: '旅行记录' }, { value: 'editing', label: '剪辑素材' }]} onValueChange={(value) => { const next = value as AiSelectionPurpose; setPurpose(next); void controls.apply({ type: 'set-purpose', purpose: next }) }} /></label>
    <label><span>建议数量</span><ButtonGroup options={[{ value: 'quick', label: '少' }, { value: 'balanced', label: '适中' }, { value: 'deep', label: '多' }]} value={session.preset ?? preset} onChange={(value) => { const next = value as typeof preset; setPreset(next); void controls.apply({ type: 'set-preset', preset: next }) }} /></label>
    <label><span>选片目标</span><ButtonGroup options={[{ value: 'preset', label: '自动' }, { value: 'count', label: '数量' }, { value: 'ratio', label: '比例' }]} value={session.target.mode} onChange={(value) => updateTarget(value as AiSelectionTarget['mode'])} /></label>
    {session.target.mode !== 'preset' && <label><span>{session.target.mode === 'count' ? '目标数量' : '目标比例'}</span><Input variant="compact" value={targetValue} onChange={(event) => setTargetValue(event.target.value.replace(/\D/g, ''))} onBlur={() => updateTarget(session.target.mode)} placeholder={session.target.mode === 'count' ? '张/段' : '%'} /></label>}
  </div></Dialog>
}
