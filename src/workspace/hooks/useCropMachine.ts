import { useCallback, useRef, useState } from 'react'

import type { CropPreset } from '../transform/TransformPanel'
import type { EditPipeline, PipelinePatch } from '../shared/editPipeline'
import { cropForAspect, frameAspect, maxCropInsideImage } from '../transform/cropGeometry'
import type { WorkspaceTool } from '../components/WorkspaceEditSidebar'

export function useCropMachine(
  pipeline: EditPipeline,
  commitPatch: (patch: PipelinePatch) => void,
  setActiveTool: (tool: WorkspaceTool) => void,
) {
  const [cropActive, setCropActive] = useState(false)
  const [transformDraft, setTransformDraft] = useState<EditPipeline['transform'] | null>(null)
  const [cropPreset, setCropPreset] = useState<CropPreset>('original')
  const [cropSize, setCropSize] = useState({ width: 0, height: 0 })
  const previousToolRef = useRef<WorkspaceTool>('color')

  const activeTransform = cropActive && transformDraft ? transformDraft : pipeline.transform

  const setPreviousTool = useCallback((tool: WorkspaceTool) => {
    previousToolRef.current = tool
  }, [])

  const startCrop = useCallback(
    (sourceAspect: number) => {
      const aspectRatio = cropPreset === 'original'
        ? frameAspect(sourceAspect, pipeline.transform.orientation)
        : cropPreset === 'free' ? null
        : (cropSize.width || Math.round(sourceAspect * 2160)) / Math.max(cropSize.height || 2160, 1)
      const crop = pipeline.transform.crop ?? maxCropInsideImage({
        sourceAspect,
        orientation: pipeline.transform.orientation,
        rotate: pipeline.transform.rotate,
        aspectRatio,
      })
      setTransformDraft({ ...pipeline.transform, crop })
      if (cropSize.width <= 0 || cropSize.height <= 0) {
        setCropSize({ width: Math.round(sourceAspect * 2160), height: 2160 })
      }
      setCropActive(true)
    },
    [cropPreset, cropSize, pipeline.transform],
  )

  const applyCropAspect = useCallback(
    (targetAspect: number, sourceAspect: number, nextSize?: { width: number; height: number }) => {
      if (!cropActive) setCropActive(true)
      setTransformDraft((current) => ({
        ...(current ?? pipeline.transform),
        crop: cropForAspect(sourceAspect, activeTransform.orientation, targetAspect),
      }))
      if (nextSize) setCropSize(nextSize)
    },
    [cropActive, pipeline.transform, activeTransform.orientation],
  )

  const handleCropPresetChange = useCallback(
    (preset: CropPreset, sourceAspect: number) => {
      setCropPreset(preset)
      if (!cropActive) setCropActive(true)
      if (preset === 'free') return
      if (preset === 'original') {
        applyCropAspect(sourceAspect, sourceAspect, { width: Math.round(sourceAspect * 2160), height: 2160 })
        return
      }
      if (preset === 'custom') {
        const width = cropSize.width || Math.round(sourceAspect * 2160)
        const height = cropSize.height || 2160
        applyCropAspect(width / Math.max(height, 1), sourceAspect, { width, height })
        return
      }
      const [w, h] = preset.split(':').map(Number)
      applyCropAspect(w / h, sourceAspect, { width: w * 1000, height: h * 1000 })
    },
    [cropActive, cropSize, applyCropAspect],
  )

  const handleCropSizeChange = useCallback(
    (size: { width?: number; height?: number }, sourceAspect: number) => {
      const width = Math.max(1, Math.round(size.width ?? (cropSize.width || Math.round(sourceAspect * 2160))))
      const height = Math.max(1, Math.round(size.height ?? (cropSize.height || 2160)))
      setCropPreset('custom')
      applyCropAspect(width / height, sourceAspect, { width, height })
    },
    [cropSize, applyCropAspect],
  )

  const handleRotateChange = useCallback(
    (rotate: number) => {
      if (!cropActive) {
        setTransformDraft({
          ...pipeline.transform,
          crop: pipeline.transform.crop ?? { x: 0, y: 0, w: 1, h: 1 },
          rotate,
        })
        setCropActive(true)
        return
      }
      setTransformDraft((current) => ({ ...(current ?? pipeline.transform), rotate }))
    },
    [cropActive, pipeline.transform],
  )

  const confirmCrop = useCallback(() => {
    if (transformDraft) commitPatch({ transform: transformDraft })
    setCropActive(false)
    setTransformDraft(null)
    setActiveTool(previousToolRef.current)
  }, [transformDraft, commitPatch, setActiveTool])

  const cancelCrop = useCallback(() => {
    setTransformDraft(null)
    setCropActive(false)
    setActiveTool(previousToolRef.current)
  }, [setActiveTool])

  const exitCropMode = useCallback(() => {
    setTransformDraft(null)
    setCropActive(false)
  }, [])

  return {
    cropActive,
    transformDraft,
    cropPreset,
    cropSize,
    activeTransform,
    setCropActive,
    setCropPreset,
    setCropSize,
    setTransformDraft,
    setPreviousTool,
    startCrop,
    applyCropAspect,
    handleCropPresetChange,
    handleCropSizeChange,
    handleRotateChange,
    confirmCrop,
    cancelCrop,
    exitCropMode,
  }
}
