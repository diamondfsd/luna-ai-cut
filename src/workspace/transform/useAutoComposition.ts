import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { decodeInstanceIds } from '../removal/instanceStrokeSelection'
import { autoCropForSubject, subjectBoundsFromInstances } from './autoComposition'

interface AutoCompositionOptions {
  filePath: string | null
  enabled: boolean
  sourceAspect: number
  targetAspect: number
  transform: EditPipeline['transform']
  onApply: (crop: NonNullable<EditPipeline['transform']['crop']>) => void
}

export function useAutoComposition(options: AutoCompositionOptions) {
  const [loading, setLoading] = useState(false)
  const requestRef = useRef<string | null>(null)

  useEffect(() => {
    setLoading(false)
    return () => {
      const requestId = requestRef.current
      requestRef.current = null
      if (requestId) void window.luna.workspace.cancelSegmentation(requestId)
    }
  }, [options.filePath])

  const apply = useCallback(async (): Promise<void> => {
    if (!options.enabled || !options.filePath || loading) return
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setLoading(true)
    try {
      const result = await window.luna.workspace.segmentInstances({ requestId, filePath: options.filePath })
      if (requestRef.current !== requestId || result.requestId !== requestId) return
      const subject = subjectBoundsFromInstances(
        decodeInstanceIds(result.instanceIds),
        result.width,
        result.height,
      )
      if (!subject) {
        toast.error('没有识别到适合自动构图的主体')
        return
      }
      options.onApply(autoCropForSubject({
        sourceAspect: options.sourceAspect,
        targetAspect: options.targetAspect,
        orientation: options.transform.orientation,
        rotate: options.transform.rotate,
        subject,
      }))
      toast.success('已完成 AI 构图')
    } catch (error) {
      if (requestRef.current === requestId) {
        toast.error(error instanceof Error ? error.message : 'AI 构图失败，请重试')
      }
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null
        setLoading(false)
      }
    }
  }, [loading, options])

  return { loading, apply }
}
