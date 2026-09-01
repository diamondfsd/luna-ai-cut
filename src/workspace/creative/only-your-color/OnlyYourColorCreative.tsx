import { ArrowLeft, Download, RotateCcw, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { LrcRender } from '../../../components/LrcRender'
import { WebGpuVideoPreview } from '../../../components/WebGpuVideoPreview'
import { useApp } from '../../../context/AppContext'
import { useDeviceWatermark } from '../../../hooks/useDeviceWatermark'
import type { MediaMetadata, PreviewLayer, WorkspaceOnlyYourColorState } from '../../../shared/types'
import { usesCustomWatermark } from '../../../shared/watermarkGeometry'
import { Button, IconButton, LoadingIndicator, toast } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { WorkspaceMediaImportButtons } from '../../components/WorkspaceMediaImportButtons'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { assetSourceUrl, loadCreativeImageSize, normalizeCreativePipeline } from '../shared/creativeMedia'
import { CreativeCompareButton } from '../shared/CreativeCompareButton'
import type { CreativeModuleProps } from '../creativeCatalog'
import { subjectBoundsFromMask } from '../pixel-stretch/pixelStretchLayers'
import { exportOnlyYourColorBatch } from './onlyYourColorBatchExport'
import { calculateOnlyYourColorAutoToneForFile } from './onlyYourColorAutoTone'
import { buildOnlyYourColorLayers } from './onlyYourColorLayers'
import {
  ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID,
  ONLY_YOUR_COLOR_MASK_LAYER_ID,
  onlyYourColorBackgroundMaskLayer,
  onlyYourColorMaskLayer,
} from './onlyYourColorMask'
import { refineOnlyYourColorMask } from './onlyYourColorMaskRefinement'
import {
  DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE,
  DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_BRIGHTNESS,
  DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_CONTRAST,
  DEFAULT_ONLY_YOUR_COLOR_INTENSITY,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE,
  normalizeOnlyYourColorBackgroundExposure,
  normalizeOnlyYourColorBackgroundBrightness,
  normalizeOnlyYourColorBackgroundContrast,
  normalizeOnlyYourColorIntensity,
  normalizeOnlyYourColorSubjectSaturation,
  normalizeOnlyYourColorSubjectExposure,
  normalizeOnlyYourColorSubjectVibrance,
  onlyYourColorStateForAsset,
} from './onlyYourColorState'
import './only-your-color.css'

export function OnlyYourColorCreative({ onBack, onAddMedia, onImportLocal, supportedMediaKinds }: CreativeModuleProps) {
  const { settings } = useApp()
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const activeAsset = media.activeMedia
  const projectId = media.currentProject?.id
  const activeAssetId = activeAsset?.id
  const ownerKey = projectId && activeAssetId ? `${projectId}:${activeAssetId}` : null
  const saved = onlyYourColorStateForAsset(media.currentProject, activeAssetId)
  const allowWatermark = useDeviceWatermark(activeAsset)
  const [intensity, setIntensity] = useState(normalizeOnlyYourColorIntensity(saved?.intensity))
  const [subjectExposure, setSubjectExposure] = useState(normalizeOnlyYourColorSubjectExposure(saved?.subjectExposure))
  const [backgroundExposure, setBackgroundExposure] = useState(normalizeOnlyYourColorBackgroundExposure(saved?.backgroundExposure))
  const [backgroundBrightness, setBackgroundBrightness] = useState(normalizeOnlyYourColorBackgroundBrightness(saved?.backgroundBrightness))
  const [backgroundContrast, setBackgroundContrast] = useState(normalizeOnlyYourColorBackgroundContrast(saved?.backgroundContrast))
  const [subjectSaturation, setSubjectSaturation] = useState(normalizeOnlyYourColorSubjectSaturation(saved?.subjectSaturation))
  const [subjectVibrance, setSubjectVibrance] = useState(normalizeOnlyYourColorSubjectVibrance(saved?.subjectVibrance))
  const [subjectModel, setSubjectModel] = useState<NonNullable<WorkspaceOnlyYourColorState['subjectModel']>>(saved?.subjectModel ?? 'fast')
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskPath ?? null)
  const [maskOwnerId, setMaskOwnerId] = useState<string | null>(saved?.maskPath ? activeAssetId ?? null : null)
  const [restoredOwnerKey, setRestoredOwnerKey] = useState(ownerKey)
  const [maskData, setMaskData] = useState<{ data: Uint8Array; width: number; height: number } | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const [pointPicking, setPointPicking] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [effectRenderedMaskPath, setEffectRenderedMaskPath] = useState<string | null>(null)
  const [webGpuPreviewFailed, setWebGpuPreviewFailed] = useState(false)
  const requestRef = useRef<string | null>(null)
  const pendingEffectToastRef = useRef<string | null>(null)
  const activeAssetIdRef = useRef(activeAssetId)
  activeAssetIdRef.current = activeAssetId
  const automaticAttemptRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const maskLayerOwnerRef = useRef<string | null>(null)
  const isImage = activeAsset?.kind === 'image'
  const activeMaskPath = maskOwnerId === activeAssetId ? maskPath : null
  const useWebGpuPreview = isImage && (settings?.experimentalWebGpuPreview ?? true) && !webGpuPreviewFailed
  const subjectMaskLayer = edit.pipeline.colorMasks.find((layer) => layer.id === ONLY_YOUR_COLOR_MASK_LAYER_ID)
  const backgroundMaskLayer = edit.pipeline.colorMasks.find((layer) => layer.id === ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID)

  useEffect(() => {
    const restored = onlyYourColorStateForAsset(media.currentProject, activeAssetId)
    setIntensity(normalizeOnlyYourColorIntensity(restored?.intensity))
    setSubjectExposure(normalizeOnlyYourColorSubjectExposure(restored?.subjectExposure))
    setBackgroundExposure(normalizeOnlyYourColorBackgroundExposure(restored?.backgroundExposure))
    setBackgroundBrightness(normalizeOnlyYourColorBackgroundBrightness(restored?.backgroundBrightness))
    setBackgroundContrast(normalizeOnlyYourColorBackgroundContrast(restored?.backgroundContrast))
    setSubjectSaturation(normalizeOnlyYourColorSubjectSaturation(restored?.subjectSaturation))
    setSubjectVibrance(normalizeOnlyYourColorSubjectVibrance(restored?.subjectVibrance))
    setSubjectModel(restored?.subjectModel ?? 'fast')
    setRestoredOwnerKey(ownerKey)
    setShowOriginal(false)
    // 只在项目或素材切换时恢复，避免自动保存引起面板重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  useEffect(() => {
    setWebGpuPreviewFailed(false)
  }, [activeAssetId])

  useEffect(() => {
    const restoredPath = onlyYourColorStateForAsset(media.currentProject, activeAssetId)?.maskPath ?? null
    setMaskPath(restoredPath)
    setMaskOwnerId(restoredPath ? activeAssetId ?? null : null)
    maskLayerOwnerRef.current = null
    setMaskData(null)
    // 保留上一张图片的画布尺寸，避免切换素材时卸载 WebGPU 预览并重新申请设备。
    setMetadata(null)
    pendingEffectToastRef.current = null
    setEffectRenderedMaskPath(null)
    if (!activeAsset || activeAsset.kind !== 'image') return
    let cancelled = false
    Promise.all([
      loadCreativeImageSize(activeAsset),
      window.luna.getMediaMetadataByPath(activeAsset.path).catch(() => ({ groups: [] })),
    ]).then(([size, nextMetadata]) => {
      if (!cancelled) {
        setSourceSize(size)
        setMetadata(nextMetadata)
      }
    }).catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : '无法读取图片信息')
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetId, activeAsset?.kind, activeAsset?.path, projectId])

  useEffect(() => {
    setPointPicking(false)
    setSegmenting(false)
    setProgress('')
    automaticAttemptRef.current = null
    return () => {
      const requestId = requestRef.current
      if (!requestId) return
      requestRef.current = null
      void window.luna.workspace.cancelSegmentation(requestId)
    }
  }, [activeAssetId])

  useEffect(() => {
    if (!subjectMaskLayer?.path || maskLayerOwnerRef.current !== activeAssetId) return
    setMaskOwnerId(activeAssetId ?? null)
    setMaskPath(subjectMaskLayer.path)
    if (backgroundMaskLayer?.path === subjectMaskLayer.path) return
    edit.commitPatch({
      colorMasks: edit.pipeline.colorMasks.map((layer) => layer.id === ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID
        ? onlyYourColorBackgroundMaskLayer(subjectMaskLayer.path, subjectMaskLayer.width, subjectMaskLayer.height, layer)
        : layer),
    })
  }, [activeAssetId, backgroundMaskLayer?.path, edit, subjectMaskLayer])

  useEffect(() => {
    if (!activeMaskPath || !projectId) {
      setMaskData(null)
      return
    }
    let cancelled = false
    window.luna.workspace.loadColorMask(projectId, activeMaskPath).then((loaded) => {
      if (cancelled) return
      const data = new Uint8Array(loaded.bytes)
      if (!subjectBoundsFromMask(data, loaded.width, loaded.height)) throw new Error('主体蒙版为空')
      setMaskData({ data, width: loaded.width, height: loaded.height })
    }).catch(() => {
      if (!cancelled) {
        setMaskPath(null)
        setMaskOwnerId(null)
        setMaskData(null)
      }
    })
    return () => { cancelled = true }
  }, [activeMaskPath, projectId])

  useEffect(() => {
    if (!activeMaskPath || !maskData || subjectMaskLayer && backgroundMaskLayer) return
    maskLayerOwnerRef.current = activeAssetId ?? null
    edit.commitPatch({
      colorMasks: [
        ...edit.pipeline.colorMasks.filter((layer) => layer.id !== ONLY_YOUR_COLOR_MASK_LAYER_ID && layer.id !== ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID),
        onlyYourColorMaskLayer(activeMaskPath, maskData.width, maskData.height, subjectMaskLayer),
        onlyYourColorBackgroundMaskLayer(activeMaskPath, maskData.width, maskData.height, backgroundMaskLayer),
      ],
    })
  }, [activeAssetId, activeMaskPath, backgroundMaskLayer, edit, maskData, subjectMaskLayer])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId || restoredOwnerKey !== ownerKey) return
    const nextState: WorkspaceOnlyYourColorState = {
      intensity,
      subjectExposure,
      backgroundExposure,
      backgroundBrightness,
      backgroundContrast,
      subjectSaturation,
      subjectVibrance,
      subjectModel,
      maskPath: activeMaskPath ?? undefined,
      maskAssetId: activeMaskPath ? activeAssetId : undefined,
    }
    const nextProject = {
      ...project,
      creative: {
        ...project.creative,
        onlyYourColor: nextState,
        onlyYourColorByAssetId: {
          ...project.creative?.onlyYourColorByAssetId,
          [activeAssetId]: nextState,
        },
      },
    }
    pendingProjectRef.current = nextProject
    media.setCurrentProject(nextProject)
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void window.luna.workspace.saveProject(nextProject).catch(() => undefined)
    }, 300)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetId, activeMaskPath, backgroundBrightness, backgroundContrast, backgroundExposure, intensity, ownerKey, restoredOwnerKey, subjectExposure, subjectModel, subjectSaturation, subjectVibrance])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    if (requestRef.current) void window.luna.workspace.cancelSegmentation(requestRef.current)
  }, [])

  const outputSize = useMemo(() => sourceSize ? outputSizeForTransform(sourceSize, edit.pipeline.transform) : null, [edit.pipeline.transform, sourceSize])
  const baseLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return buildWorkspaceExportLayers(activeAsset.path, sourceSize, edit.pipeline, metadata, allowWatermark || usesCustomWatermark(edit.pipeline.watermark), undefined, activeAsset)
  }, [activeAsset, allowWatermark, edit.pipeline, metadata, sourceSize])
  const effectLayers = useMemo(() => activeAsset && activeMaskPath
    ? buildOnlyYourColorLayers({
      layers: baseLayers,
      sourcePath: activeAsset.path,
      subjectMaskPath: subjectMaskLayer?.path ?? activeMaskPath,
      backgroundMaskPath: backgroundMaskLayer?.path ?? activeMaskPath,
      intensity,
      subjectExposure,
      backgroundExposure,
      backgroundBrightness,
      backgroundContrast,
      subjectSaturation,
      subjectVibrance,
      subjectMaskInverted: subjectMaskLayer?.inverted,
      backgroundMaskInverted: backgroundMaskLayer?.inverted,
    })
    : baseLayers, [activeAsset, activeMaskPath, backgroundBrightness, backgroundContrast, backgroundExposure, backgroundMaskLayer, baseLayers, intensity, subjectExposure, subjectMaskLayer, subjectSaturation, subjectVibrance])
  const previewLayers = useMemo(() => {
    const layers = showOriginal ? baseLayers : effectLayers
    if (!projectId) return layers
    return layers.map((layer) => layer.maskPath || layer.maskTimeline ? { ...layer, maskProjectId: projectId } : layer)
  }, [baseLayers, effectLayers, projectId, showOriginal])

  const handleWebGpuPreviewError = useCallback(() => {
    setWebGpuPreviewFailed(true)
    toast.error('预览加速暂时不可用，已切回通用预览')
  }, [])

  function recognizeSubject(value: NonNullable<WorkspaceOnlyYourColorState['subjectModel']>): void {
    if (segmenting) return
    setPointPicking(false)
    setSubjectModel(value)
    void segmentSubject(undefined, value)
  }

  const segmentSubject = useCallback(async (
    point?: { x: number; y: number },
    model: NonNullable<WorkspaceOnlyYourColorState['subjectModel']> = subjectModel,
  ) => {
    if (!activeAsset || !media.currentProject || activeAsset.kind !== 'image' || segmenting) return
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setSegmenting(true)
    setProgress(point ? '正在识别点选区域' : '正在识别主体')
    const unsubscribe = window.luna.onWorkspaceSegmentationProgress((event) => {
      if (event.requestId === requestId) setProgress(event.label)
    })
    try {
      const result = await window.luna.workspace.segmentImage(point
        ? { requestId, filePath: activeAsset.path, point, modelId: 'slimsam-77-uniform' }
        : { requestId, filePath: activeAsset.path, modelId: model === 'precise' ? 'birefnet-general-lite' : 'rmbg-1.4' })
      if (requestRef.current !== requestId) return
      const selectedMask = refineOnlyYourColorMask(new Uint8Array(result.bytes), result.width, result.height)
      if (!subjectBoundsFromMask(selectedMask, result.width, result.height)) throw new Error(point ? '点选区域没有有效主体' : '未识别到主体，可使用点选')
      const [savedMask, autoTone] = await Promise.all([
        window.luna.workspace.saveColorMask(media.currentProject.id, activeAsset.id, result.width, result.height, selectedMask, 1),
        activeMaskPath
          ? Promise.resolve(null)
          : calculateOnlyYourColorAutoToneForFile({
            filePath: activeAsset.path,
            mask: selectedMask,
            maskWidth: result.width,
            maskHeight: result.height,
          }),
      ])
      if (requestRef.current !== requestId) return
      if (autoTone) {
        setSubjectExposure(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE)
        setBackgroundExposure(autoTone.backgroundExposure)
        setBackgroundBrightness(autoTone.backgroundBrightness)
        setBackgroundContrast(autoTone.backgroundContrast)
        setSubjectSaturation(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION)
        setSubjectVibrance(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE)
      }
      setMaskData({ data: selectedMask, width: result.width, height: result.height })
      setMaskOwnerId(activeAsset.id)
      setMaskPath(savedMask.path)
      maskLayerOwnerRef.current = activeAsset.id
      edit.commitPatch({
        colorMasks: [
          ...edit.pipeline.colorMasks.filter((layer) => layer.id !== ONLY_YOUR_COLOR_MASK_LAYER_ID && layer.id !== ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID),
          onlyYourColorMaskLayer(savedMask.path, result.width, result.height, subjectMaskLayer),
          onlyYourColorBackgroundMaskLayer(savedMask.path, result.width, result.height, backgroundMaskLayer),
        ],
      })
      setPointPicking(false)
      pendingEffectToastRef.current = point ? '已更新色彩主体' : '主体已识别，背景已转为黑白'
    } catch (error) {
      if (requestRef.current === requestId) {
        setPointPicking(false)
        toast.error(error instanceof Error ? error.message : point ? '点选识别失败，请重试' : '未识别到主体，可使用点选')
      }
    } finally {
      unsubscribe()
      if (requestRef.current === requestId) {
        requestRef.current = null
        setSegmenting(false)
        setProgress('')
      }
    }
  }, [activeAsset, activeMaskPath, backgroundMaskLayer, edit, media.currentProject, segmenting, subjectMaskLayer, subjectModel])

  const handleEffectRender = useCallback(() => {
    if (!activeMaskPath || showOriginal) return
    setEffectRenderedMaskPath(activeMaskPath)
    const message = pendingEffectToastRef.current
    if (message) {
      pendingEffectToastRef.current = null
      toast.success(message)
    }
  }, [activeMaskPath, showOriginal])

  const resetEffect = useCallback(async () => {
    setIntensity(DEFAULT_ONLY_YOUR_COLOR_INTENSITY)
    setSubjectExposure(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE)
    setBackgroundExposure(DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE)
    setBackgroundBrightness(DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_BRIGHTNESS)
    setBackgroundContrast(DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_CONTRAST)
    setSubjectSaturation(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION)
    setSubjectVibrance(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE)
    if (!activeAsset || !maskData) return
    const autoTone = await calculateOnlyYourColorAutoToneForFile({
      filePath: activeAsset.path,
      mask: maskData.data,
      maskWidth: maskData.width,
      maskHeight: maskData.height,
    })
    if (activeAssetIdRef.current !== activeAsset.id) return
    setBackgroundExposure(autoTone.backgroundExposure)
    setBackgroundBrightness(autoTone.backgroundBrightness)
    setBackgroundContrast(autoTone.backgroundContrast)
  }, [activeAsset, maskData])

  useEffect(() => {
    if (!isImage || !activeAsset || activeMaskPath || segmenting || restoredOwnerKey !== ownerKey) return
    if (automaticAttemptRef.current === activeAsset.id) return
    automaticAttemptRef.current = activeAsset.id
    void segmentSubject()
  }, [activeAsset, activeMaskPath, isImage, ownerKey, restoredOwnerKey, segmentSubject, segmenting])

  function handlePreviewClick(event: MouseEvent<HTMLDivElement>): void {
    if (!pointPicking || segmenting) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    void segmentSubject({
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    })
  }

  const exportableIndices = useMemo(() => {
    const selected = [...media.selectedIndices].filter((index) => {
      const asset = media.media[index]
      return asset?.kind === 'image' && !media.brokenPaths.has(asset.path)
    })
    if (selected.length > 0) return selected
    return activeAsset?.kind === 'image' && !media.brokenPaths.has(activeAsset.path)
      ? [media.activeIndex]
      : []
  }, [activeAsset, media.activeIndex, media.brokenPaths, media.media, media.selectedIndices])
  const exportCount = exportableIndices.length

  const exportEffect = useCallback(async () => {
    const project = pendingProjectRef.current ?? media.currentProject
    if (!project || exportCount === 0 || exporting || segmenting) return
    setExporting(true)
    setExportProgress('准备导出')
    try {
      const result = await exportOnlyYourColorBatch({
        project,
        sources: exportableIndices.map((index) => {
          const asset = media.media[index]
          return {
            asset,
            pipeline: index === media.activeIndex
              ? edit.pipeline
              : normalizeCreativePipeline((asset as { pipeline?: unknown }).pipeline),
          }
        }),
        onProgress: setExportProgress,
      })
      if (Object.keys(result.recognizedStates).length > 0) {
        const latestProject = pendingProjectRef.current?.id === project.id ? pendingProjectRef.current : project
        const persistedRecognizedStates = Object.fromEntries(Object.entries(result.recognizedStates).map(([assetId, recognized]) => {
          const current = onlyYourColorStateForAsset(latestProject, assetId)
          return [assetId, current
            ? { ...recognized, ...current, maskPath: recognized.maskPath, maskAssetId: assetId }
            : recognized]
        }))
        const nextProject = {
          ...latestProject,
          updatedAt: new Date().toISOString(),
          creative: {
            ...latestProject.creative,
            onlyYourColorByAssetId: {
              ...latestProject.creative?.onlyYourColorByAssetId,
              ...persistedRecognizedStates,
            },
          },
        }
        pendingProjectRef.current = nextProject
        media.setCurrentProject(nextProject)
        await window.luna.workspace.saveProject(nextProject)
        const activeResolved = activeAssetId ? persistedRecognizedStates[activeAssetId] : undefined
        if (activeResolved?.maskPath) {
          setMaskOwnerId(activeAssetId ?? null)
          setMaskPath(activeResolved.maskPath)
        }
      }
      if (result.failedCount === 0) toast.success(`已导出 ${result.exportedCount} 张图片`)
      else if (result.exportedCount > 0) toast.show(`已导出 ${result.exportedCount} 张，${result.failedCount} 张失败`)
      else toast.error('批量导出失败，请查看导出任务')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片导出失败')
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }, [activeAssetId, edit.pipeline, exportCount, exportableIndices, exporting, media, segmenting])

  return <section className="only-your-color-page">
    <header className="only-your-color-toolbar"><Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button><span>只有你的色彩</span><WorkspaceMediaImportButtons onAddMedia={onAddMedia} onImportLocal={onImportLocal} /><CreativeCompareButton className="only-your-color-compare" active={showOriginal} disabled={!isImage || !sourceSize} onActiveChange={setShowOriginal} /></header>
    <div className="only-your-color-preview">
      {activeAsset && !isImage ? <div className="only-your-color-empty"><ScanSearch size={28} /><strong>请选择图片素材</strong><span>只有你的色彩目前支持图片素材</span></div>
        : previewLayers.length && outputSize ? <div className={`only-your-color-stage${pointPicking ? ' is-point-picking' : ''}`} data-effect-rendered={activeMaskPath && effectRenderedMaskPath === activeMaskPath ? 'true' : 'false'} style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }} onClick={handlePreviewClick}>{useWebGpuPreview ? <WebGpuVideoPreview className="only-your-color-canvas" layers={previewLayers} canvasWidth={outputSize.width} canvasHeight={outputSize.height} maxSide={960} playing={false} interactiveImageLayerIndexes={[]} onError={handleWebGpuPreviewError} onRender={handleEffectRender} /> : <LrcRender className="only-your-color-canvas" layers={previewLayers} canvasWidth={outputSize.width} canvasHeight={outputSize.height} maxSide={960} interactiveImageLayerIndexes={[]} onError={toast.error} onRender={handleEffectRender} />}{!showOriginal && pointPicking && <span className="only-your-color-point-hint">点击要保留色彩的主体</span>}</div>
          : activeAsset && isImage ? <img className="only-your-color-source-fallback" src={assetSourceUrl(activeAsset)} alt="" />
            : <div className="only-your-color-empty"><ScanSearch size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要突出色彩主体的图片</span></div>}
    </div>
    <aside className="only-your-color-panel"><div className="only-your-color-panel-head"><strong>效果设置</strong><span>主体保留原色，背景转为黑白</span></div>
      <div className="only-your-color-options"><span>智能选择</span><div className="only-your-color-detect-actions"><Button variant={subjectModel === 'fast' && !pointPicking ? 'primary' : 'secondary'} size="compact" disabled={!isImage || segmenting} onClick={() => recognizeSubject('fast')}>快速</Button><Button variant={subjectModel === 'precise' && !pointPicking ? 'primary' : 'secondary'} size="compact" disabled={!isImage || segmenting} onClick={() => recognizeSubject('precise')}>精准</Button><Button variant={pointPicking ? 'primary' : 'secondary'} size="compact" disabled={!isImage || segmenting} onClick={() => setPointPicking(true)}>点选主体</Button></div>{segmenting && <div className="only-your-color-loading" role="status"><LoadingIndicator /><div><strong>{progress || '正在识别'}</strong><span>{subjectModel === 'precise' ? '精准识别' : '快速识别'}处理中</span></div></div>}{pointPicking && !segmenting && <span className="only-your-color-status">在预览图中点击需要保留色彩的区域</span>}<ParamSlider label="主体曝光" value={subjectExposure} min={-5} max={5} step={0.01} onChange={setSubjectExposure} /><ParamSlider label="主体饱和度" value={subjectSaturation} min={-100} max={100} onChange={setSubjectSaturation} /><ParamSlider label="主体鲜艳度" value={subjectVibrance} min={-100} max={100} onChange={setSubjectVibrance} /><ParamSlider label="背景黑白强度" value={intensity} min={0} max={100} onChange={setIntensity} /><ParamSlider label="背景曝光" value={backgroundExposure} min={-5} max={5} step={0.01} onChange={setBackgroundExposure} /><ParamSlider label="背景亮度" value={backgroundBrightness} min={-100} max={100} onChange={setBackgroundBrightness} /><ParamSlider label="背景对比度" value={backgroundContrast} min={-100} max={100} onChange={setBackgroundContrast} /></div>
      <div className="only-your-color-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置效果" aria-label="重置效果" onClick={() => void resetEffect()} /><Button variant="primary" size="compact" icon={<Download size={14} />} disabled={exportCount === 0 || exporting || segmenting} onClick={() => void exportEffect()}>{exporting ? exportProgress || '导出中' : exportCount > 1 ? `导出 ${exportCount} 张` : '导出图片'}</Button></div>
    </aside>
    <div className="only-your-color-media-strip"><WorkspaceMediaStrip supportedMediaKinds={supportedMediaKinds} /></div>
  </section>
}
