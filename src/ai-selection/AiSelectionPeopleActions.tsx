import { useEffect, useState, type ReactNode } from 'react'
import { EyeOff, RefreshCw } from 'lucide-react'

import type { AiHiddenPerson } from '../shared/types'
import { Button, IconButton, Input, LoadingIndicator, Switch, Tooltip } from '../ui'
import { AiHiddenPeopleDialog } from './AiHiddenPeopleDialog'
import './AiSelectionPeopleActions.css'

interface AiSelectionPeopleActionsProps {
  hiddenPeople: AiHiddenPerson[]
  title: string
  countLabel: string
  busy: boolean
  canShowFaceBoxes: boolean
  showFaceBoxes: boolean
  analysisLabel: string | null
  selectAllAction: ReactNode
  canAnalyze: boolean
  faceGroupingThreshold: number
  onAnalyze: () => void
  onFaceGroupingThresholdChange: (threshold: number) => Promise<boolean>
  onShowFaceBoxesChange: (checked: boolean) => void
  onRestore: (personId: string) => Promise<boolean>
}

export function AiSelectionPeopleActions({
  hiddenPeople,
  title,
  countLabel,
  busy,
  canShowFaceBoxes,
  showFaceBoxes,
  analysisLabel,
  selectAllAction,
  canAnalyze,
  faceGroupingThreshold,
  onAnalyze,
  onFaceGroupingThresholdChange,
  onShowFaceBoxesChange,
  onRestore,
}: AiSelectionPeopleActionsProps) {
  const [hiddenPeopleOpen, setHiddenPeopleOpen] = useState(false)
  const [thresholdValue, setThresholdValue] = useState(faceGroupingThreshold.toFixed(2))

  useEffect(() => { setThresholdValue(faceGroupingThreshold.toFixed(2)) }, [faceGroupingThreshold])

  function applyThreshold(): void {
    const value = Number(thresholdValue)
    if (!Number.isFinite(value) || value < 0.4 || value > 0.6) {
      setThresholdValue(faceGroupingThreshold.toFixed(2))
      return
    }
    void onFaceGroupingThresholdChange(value)
  }

  return <>
    <header className="ai-selection-view-heading">
      <div>
        <h2>{title}</h2>
        {analysisLabel ? <div className="ai-selection-heading-loading"><LoadingIndicator label={analysisLabel} /></div> : <span>{countLabel}</span>}
      </div>
      <div className="ai-selection-view-actions ai-selection-people-actions">
        <label className="ai-selection-people-threshold"><span>分组阈值</span><Input variant="compact" type="number" min="0.40" max="0.60" step="0.01" inputMode="decimal" value={thresholdValue} disabled={busy} aria-label="人物分组阈值" onChange={(event) => setThresholdValue(event.target.value)} onBlur={applyThreshold} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyThreshold() } }} /></label>
        {canShowFaceBoxes && <label className="ai-selection-people-face-toggle"><span>显示人脸框</span><Switch checked={showFaceBoxes} onCheckedChange={onShowFaceBoxesChange} ariaLabel="显示当前人物的人脸框" /></label>}
        {selectAllAction}
        {hiddenPeople.length > 0 && <Button variant="ghost" size="compact" icon={<EyeOff size={14} />} disabled={busy} onClick={() => setHiddenPeopleOpen(true)}>已隐藏 {hiddenPeople.length}</Button>}
        <Tooltip content="重新分析人物"><IconButton variant="outline" size="compact" icon={<RefreshCw size={14} />} aria-label="重新分析人物" disabled={busy || !canAnalyze} onClick={onAnalyze} /></Tooltip>
      </div>
    </header>
    <AiHiddenPeopleDialog open={hiddenPeopleOpen} onOpenChange={setHiddenPeopleOpen} people={hiddenPeople} busy={busy} onRestore={onRestore} />
  </>
}
