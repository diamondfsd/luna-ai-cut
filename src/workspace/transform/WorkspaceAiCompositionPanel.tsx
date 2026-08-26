import { Check, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { CompositionEvidence } from '../../shared/compositionAnalysis'
import type { CropRect } from '../shared/editPipeline'
import { Button } from '../../ui'
import { compositionCropCandidates, cropSourceBounds, suggestCompositionCrop, type AiCropSuggestion } from './aiCompositionGeometry'
import type { CropConstraintOptions } from './cropGeometry'
import './workspace-ai-composition.css'

interface WorkspaceAiCompositionPanelProps {
  filePath: string | null
  frameTime?: number
  sourceAspect: number
  orientation: number
  rotate: number
  aspectRatio: number | null
  crop: CropRect | null
  onApply: (crop: CropRect) => void
}

interface AnalysisResult {
  evidence: CompositionEvidence
  suggestion: AiCropSuggestion | null
}

export function WorkspaceAiCompositionPanel({
  filePath,
  frameTime,
  sourceAspect,
  orientation,
  rotate,
  aspectRatio,
  crop,
  onApply,
}: WorkspaceAiCompositionPanelProps) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const requestIdRef = useRef(0)

  useEffect(() => {
    requestIdRef.current += 1
    setBusy(false)
    setResult(null)
    setError(null)
    setApplied(false)
  }, [filePath, frameTime, sourceAspect, orientation, rotate, aspectRatio])

  async function analyze(): Promise<void> {
    if (!filePath || busy) return
    const requestId = ++requestIdRef.current
    setBusy(true)
    setError(null)
    setApplied(false)
    try {
      const evidence = await window.luna.workspace.analyzeComposition({
        requestId: `composition_${Date.now()}_${requestId}`,
        filePath,
        frameTime,
      })
      if (requestId !== requestIdRef.current) return
      const options: CropConstraintOptions = { sourceAspect, orientation, rotate, aspectRatio }
      const candidateSet = compositionCropCandidates(evidence.bounds, options, crop)
      let suggestion: AiCropSuggestion | null = null
      if (candidateSet) {
        const modelScores = await window.luna.workspace.scoreCompositionCrops({
          requestId: `composition-crops_${Date.now()}_${requestId}`,
          filePath,
          frameTime,
          crops: candidateSet.candidates.map((candidate) => cropSourceBounds(candidate, options)),
        })
        if (requestId !== requestIdRef.current) return
        suggestion = suggestCompositionCrop(
          evidence.bounds,
          options,
          crop,
          modelScores.map((score) => score.normalized),
        )
      }
      setResult({
        evidence,
        suggestion,
      })
    } catch {
      if (requestId === requestIdRef.current) setError('当前画面暂时无法分析')
    } finally {
      if (requestId === requestIdRef.current) setBusy(false)
    }
  }

  const suggestion = result?.suggestion
  const score = suggestion ? Math.round(suggestion.score * 100) : null
  const currentScore = suggestion ? Math.round(suggestion.currentScore * 100) : null

  return (
    <section className="workspace-ai-composition-panel" aria-label="AI 构图">
      <div className="workspace-ai-composition-heading">
        <div>
          <strong>AI 构图</strong>
        <span>根据画面评分和主体边界给出裁剪建议</span>
        </div>
        <Sparkles size={17} aria-hidden="true" />
      </div>
      <Button
        variant="secondary"
        size="compact"
        icon={busy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
        disabled={!filePath || busy}
        onClick={() => void analyze()}
      >
        {busy ? '分析中' : result ? '重新分析' : '分析当前画面'}
      </Button>
      {error && <p className="workspace-ai-composition-message is-error" role="alert">{error}</p>}
      {result && !error && (
        <div className="workspace-ai-composition-result" aria-live="polite">
          <p>{result.evidence.reason}</p>
          {suggestion ? (
            <>
              <div className="workspace-ai-composition-score">
                <span>建议评分</span>
                <strong>{score}</strong>
                {currentScore !== null && score !== null && score > currentScore && <small>当前 {currentScore}</small>}
              </div>
              <p>{suggestion.reason}</p>
              <Button
                variant={applied ? 'secondary' : 'primary'}
                size="compact"
                icon={applied ? <Check size={14} /> : <Sparkles size={14} />}
                disabled={applied}
                onClick={() => {
                  onApply(suggestion.crop)
                  setApplied(true)
                }}
              >
                {applied ? '已应用建议' : '应用建议'}
              </Button>
            </>
          ) : (
            <p className="workspace-ai-composition-message">当前比例下没有找到更合适的裁剪位置</p>
          )}
        </div>
      )}
    </section>
  )
}
