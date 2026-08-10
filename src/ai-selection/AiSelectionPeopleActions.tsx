import { useEffect, useState, type ReactNode } from 'react'
import { EyeOff, RefreshCw } from 'lucide-react'

import type { AiHiddenPerson } from '../shared/types'
import { Button, IconButton, Input, LoadingIndicator, Slider, Switch, Tooltip } from '../ui'
import { AiHiddenPeopleDialog } from './AiHiddenPeopleDialog'
import './AiSelectionPeopleActions.css'

const MIN_GROUPING_THRESHOLD = 0.4
const MAX_GROUPING_THRESHOLD = 0.6

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
  const [thresholdValue, setThresholdValue] = useState(faceGroupingThreshold)
  const [thresholdInput, setThresholdInput] = useState(faceGroupingThreshold.toFixed(2))

  useEffect(() => {
    setThresholdValue(faceGroupingThreshold)
    setThresholdInput(faceGroupingThreshold.toFixed(2))
  }, [faceGroupingThreshold])

  function commitThreshold(value: number): void {
    const normalized = Number(Math.max(MIN_GROUPING_THRESHOLD, Math.min(MAX_GROUPING_THRESHOLD, value)).toFixed(2))
    setThresholdValue(normalized)
    setThresholdInput(normalized.toFixed(2))
    if (normalized !== faceGroupingThreshold) void onFaceGroupingThresholdChange(normalized)
  }

  function previewThreshold(value: number): void {
    setThresholdValue(value)
    setThresholdInput(value.toFixed(2))
  }

  function commitThresholdInput(): void {
    if (!thresholdInput.trim()) {
      setThresholdValue(faceGroupingThreshold)
      setThresholdInput(faceGroupingThreshold.toFixed(2))
      return
    }
    const value = Number(thresholdInput)
    if (Number.isFinite(value)) commitThreshold(value)
    else {
      setThresholdValue(faceGroupingThreshold)
      setThresholdInput(faceGroupingThreshold.toFixed(2))
    }
  }

  return <>
    <header className="ai-selection-view-heading">
      <div>
        <h2>{title}</h2>
        {analysisLabel ? <div className="ai-selection-heading-loading"><LoadingIndicator label={analysisLabel} /></div> : <span>{countLabel}</span>}
      </div>
      <div className="ai-selection-view-actions ai-selection-people-actions">
        <div className="ai-selection-people-threshold"><span>分组阈值</span><Slider value={thresholdValue} min={MIN_GROUPING_THRESHOLD} max={MAX_GROUPING_THRESHOLD} step={0.01} ariaLabel="人物分组阈值" disabled={busy} onValueChange={previewThreshold} onValueCommit={commitThreshold} /><Input type="number" variant="compact" className="ai-selection-people-threshold-input" value={thresholdInput} min={MIN_GROUPING_THRESHOLD} max={MAX_GROUPING_THRESHOLD} step={0.01} inputMode="decimal" aria-label="输入人物分组阈值" disabled={busy} onChange={(event) => {
          const next = event.target.value
          setThresholdInput(next)
          const value = Number(next)
          if (next && Number.isFinite(value) && value >= MIN_GROUPING_THRESHOLD && value <= MAX_GROUPING_THRESHOLD) setThresholdValue(value)
        }} onBlur={commitThresholdInput} onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setThresholdValue(faceGroupingThreshold)
            setThresholdInput(faceGroupingThreshold.toFixed(2))
          }
        }} /></div>
        {canShowFaceBoxes && <label className="ai-selection-people-face-toggle"><span>显示人脸框</span><Switch checked={showFaceBoxes} onCheckedChange={onShowFaceBoxesChange} ariaLabel="显示当前人物的人脸框" /></label>}
        {selectAllAction}
        {hiddenPeople.length > 0 && <Button variant="ghost" size="compact" icon={<EyeOff size={14} />} disabled={busy} onClick={() => setHiddenPeopleOpen(true)}>已隐藏 {hiddenPeople.length}</Button>}
        <Tooltip content="重新分析人物"><IconButton variant="outline" size="compact" icon={<RefreshCw size={14} />} aria-label="重新分析人物" disabled={busy || !canAnalyze} onClick={onAnalyze} /></Tooltip>
      </div>
    </header>
    <AiHiddenPeopleDialog open={hiddenPeopleOpen} onOpenChange={setHiddenPeopleOpen} people={hiddenPeople} busy={busy} onRestore={onRestore} />
  </>
}
