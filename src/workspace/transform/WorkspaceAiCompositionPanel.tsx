import { Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { CompositionEvidence } from '../../shared/compositionAnalysis'
import type { CropRect } from '../shared/editPipeline'
import { Button, toast } from '../../ui'
import { compositionCropCandidates, cropSourceBounds, suggestCompositionCrop } from './aiCompositionGeometry'
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

function errorMessageForComposition(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/下载|校验|网络|资源/.test(message)) return '构图模型下载失败，请检查网络后重试'
  if (/无法读取|素材路径|视频帧|图片数据/.test(message)) return '当前素材无法读取，请确认文件仍然可用'
  return '当前画面暂时无法分析，请重试'
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
  const requestIdRef = useRef(0)

  useEffect(() => {
    requestIdRef.current += 1
    setBusy(false)
  }, [filePath, frameTime, sourceAspect, orientation, rotate, aspectRatio])

  async function analyze(): Promise<void> {
    if (!filePath || busy) return
    const requestId = ++requestIdRef.current
    setBusy(true)
    try {
      const evidence: CompositionEvidence = await window.luna.workspace.analyzeComposition({
        requestId: `composition_${Date.now()}_${requestId}`,
        filePath,
        frameTime,
      })
      if (requestId !== requestIdRef.current) return
      const options: CropConstraintOptions = { sourceAspect, orientation, rotate, aspectRatio }
      const candidateSet = compositionCropCandidates(evidence.bounds, options, crop)
      if (!candidateSet) {
        toast.show('没有找到合适的裁剪')
        return
      }
      const modelScores = await window.luna.workspace.scoreCompositionCrops({
        requestId: `composition-crops_${Date.now()}_${requestId}`,
        filePath,
        frameTime,
        crops: candidateSet.candidates.map((candidate) => cropSourceBounds(candidate, options)),
      })
      if (requestId !== requestIdRef.current) return
      const suggestion = suggestCompositionCrop(
        evidence.bounds,
        options,
        crop,
        modelScores.map((score) => score.normalized),
      )
      if (!suggestion) {
        toast.show('没有找到合适的裁剪')
        return
      }
      onApply(suggestion.crop)
    } catch (error) {
      if (requestId === requestIdRef.current) toast.error(errorMessageForComposition(error))
    } finally {
      if (requestId === requestIdRef.current) setBusy(false)
    }
  }

  return (
    <section className="workspace-ai-composition-panel" aria-label="AI 构图">
      <Button
        variant="secondary"
        size="compact"
        icon={busy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}
        disabled={!filePath || busy}
        onClick={() => void analyze()}
      >
        {busy ? '构图中' : 'AI 构图'}
      </Button>
    </section>
  )
}
