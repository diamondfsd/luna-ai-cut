import { ArrowLeft, Download, RotateCcw, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { LrcRender } from '../../../components/LrcRender'
import { useLunaUltraWatermark } from '../../../hooks/useLunaUltraWatermark'
import type { MediaMetadata, PreviewLayer, WorkspaceOnlyYourColorState } from '../../../shared/types'
import { usesCustomWatermark } from '../../../shared/watermarkGeometry'
import { Button, IconButton, LoadingIndicator, SegmentedControl, toast } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { assetSourceUrl, loadCreativeImageSize } from '../shared/creativeMedia'
import { CreativeCompareButton } from '../shared/CreativeCompareButton'
import { erodeMaskOnePixel, subjectBoundsFromMask } from '../pixel-stretch/pixelStretchLayers'
import { exportOnlyYourColorImage } from './exportOnlyYourColorImage'
import { buildOnlyYourColorLayers } from './onlyYourColorLayers'
import {
  ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID,
  ONLY_YOUR_COLOR_MASK_LAYER_ID,
  onlyYourColorBackgroundMaskLayer,
  onlyYourColorMaskLayer,
} from './onlyYourColorMask'
import {
  DEFAULT_ONLY_YOUR_COLOR_INTENSITY,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE,
  normalizeOnlyYourColorIntensity,
  normalizeOnlyYourColorSubjectSaturation,
  normalizeOnlyYourColorSubjectVibrance,
  onlyYourColorStateForAsset,
} from './onlyYourColorState'
import './only-your-color.css'

export function OnlyYourColorCreative({ onBack }: { onBack: () => void }) {
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const activeAsset = media.activeMedia
  const projectId = media.currentProject?.id
  const activeAssetId = activeAsset?.id
  const ownerKey = projectId && activeAssetId ? `${projectId}:${activeAssetId}` : null
  const saved = onlyYourColorStateForAsset(media.currentProject, activeAssetId)
  const allowWatermark = useLunaUltraWatermark(activeAsset)
  const [intensity, setIntensity] = useState(normalizeOnlyYourColorIntensity(saved?.intensity))
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
  const requestRef = useRef<string | null>(null)
  const automaticAttemptRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const maskLayerOwnerRef = useRef<string | null>(null)
  const isImage = activeAsset?.kind === 'image'
  const activeMaskPath = maskOwnerId === activeAssetId ? maskPath : null
  const subjectMaskLayer = edit.pipeline.colorMasks.find((layer) => layer.id === ONLY_YOUR_COLOR_MASK_LAYER_ID)
  const backgroundMaskLayer = edit.pipeline.colorMasks.find((layer) => layer.id === ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID)

  useEffect(() => {
    const restored = onlyYourColorStateForAsset(media.currentProject, activeAssetId)
    setIntensity(normalizeOnlyYourColorIntensity(restored?.intensity))
    setSubjectSaturation(normalizeOnlyYourColorSubjectSaturation(restored?.subjectSaturation))
    setSubjectVibrance(normalizeOnlyYourColorSubjectVibrance(restored?.subjectVibrance))
    setSubjectModel(restored?.subjectModel ?? 'fast')
    setRestoredOwnerKey(ownerKey)
    setShowOriginal(false)
    // 只在项目或素材切换时恢复，避免自动保存引起面板重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  useEffect(() => {
    const restoredPath = onlyYourColorStateForAsset(media.currentProject, activeAssetId)?.maskPath ?? null
    setMaskPath(restoredPath)
    setMaskOwnerId(restoredPath ? activeAssetId ?? null : null)
    maskLayerOwnerRef.current = null
    setMaskData(null)
    setSourceSize(null)
    setMetadata(null)
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
  }, [activeAssetId, activeMaskPath, intensity, ownerKey, restoredOwnerKey, subjectModel, subjectSaturation, subjectVibrance])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    if (requestRef.current) void window.luna.workspace.cancelSegmentation(requestRef.current)
  }, [])

  const outputSize = useMemo(() => sourceSize ? outputSizeForTransform(sourceSize, edit.pipeline.transform) : null, [edit.pipeline.transform, sourceSize])
  const baseLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return buildWorkspaceExportLayers(activeAsset.path, sourceSize, edit.pipeline, metadata, allowWatermark || usesCustomWatermark(edit.pipeline.watermark))
  }, [activeAsset, allowWatermark, edit.pipeline, metadata, sourceSize])
  const effectLayers = useMemo(() => activeAsset && activeMaskPath
    ? buildOnlyYourColorLayers({
      layers: baseLayers,
      sourcePath: activeAsset.path,
      subjectMaskPath: subjectMaskLayer?.path ?? activeMaskPath,
      backgroundMaskPath: backgroundMaskLayer?.path ?? activeMaskPath,
      intensity,
      subjectSaturation,
      subjectVibrance,
      subjectMaskInverted: subjectMaskLayer?.inverted,
      backgroundMaskInverted: backgroundMaskLayer?.inverted,
      subjectMaskFeather: subjectMaskLayer?.feather,
      backgroundMaskFeather: backgroundMaskLayer?.feather,
    })
    : baseLayers, [activeAsset, activeMaskPath, backgroundMaskLayer, baseLayers, intensity, subjectMaskLayer, subjectSaturation, subjectVibrance])
  const previewLayers = showOriginal ? baseLayers : effectLayers

  function changeSubjectModel(value: NonNullable<WorkspaceOnlyYourColorState['subjectModel']>): void {
    if (value === subjectModel) return
    const requestId = requestRef.current
    if (requestId) {
      requestRef.current = null
      void window.luna.workspace.cancelSegmentation(requestId)
      setSegmenting(false)
      setProgress('')
    }
    setPointPicking(false)
    setSubjectModel(value)
    if (value === 'precise') {
      toast.show('正在准备精准识别，完成后即可使用')
      void window.luna.workspace.prepareSegmentationModels(['birefnet-general-lite'])
        .then(() => toast.success('精准识别已准备好'))
        .catch((error) => toast.error(error instanceof Error ? error.message : '精准识别准备失败，请稍后重试'))
    }
  }

  const segmentSubject = useCallback(async (point?: { x: number; y: number }) => {
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
        : { requestId, filePath: activeAsset.path, modelId: subjectModel === 'precise' ? 'birefnet-general-lite' : 'rmbg-1.4' })
      if (requestRef.current !== requestId) return
      const selectedMask = erodeMaskOnePixel(new Uint8Array(result.bytes), result.width, result.height)
      if (!subjectBoundsFromMask(selectedMask, result.width, result.height)) throw new Error(point ? '点选区域没有有效主体' : '未识别到主体，可使用点选')
      const savedMask = await window.luna.workspace.saveColorMask(media.currentProject.id, activeAsset.id, result.width, result.height, selectedMask, 1)
      if (requestRef.current !== requestId) return
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
      toast.success(point ? '已更新色彩主体' : '主体已识别，背景已转为黑白')
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
  }, [activeAsset, backgroundMaskLayer, edit, media.currentProject, segmenting, subjectMaskLayer, subjectModel])

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

  const exportEffect = useCallback(async () => {
    if (!activeAsset || !outputSize || !activeMaskPath || exporting) return
    setExporting(true)
    try {
      await exportOnlyYourColorImage({ asset: activeAsset, layers: effectLayers, width: outputSize.width, height: outputSize.height })
      toast.success('图片已导出')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '图片导出失败')
    } finally {
      setExporting(false)
    }
  }, [activeAsset, activeMaskPath, effectLayers, exporting, outputSize])

  return <section className="only-your-color-page">
    <header className="only-your-color-toolbar"><Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button><span>只有你的色彩</span><CreativeCompareButton className="only-your-color-compare" active={showOriginal} disabled={!isImage || !sourceSize} onActiveChange={setShowOriginal} /></header>
    <div className="only-your-color-preview">
      {activeAsset && !isImage ? <div className="only-your-color-empty"><ScanSearch size={28} /><strong>请选择图片素材</strong><span>只有你的色彩目前支持图片素材</span></div>
        : previewLayers.length && outputSize ? <div className={`only-your-color-stage${pointPicking ? ' is-point-picking' : ''}`} style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }} onClick={handlePreviewClick}><LrcRender className="only-your-color-canvas" layers={previewLayers} canvasWidth={outputSize.width} canvasHeight={outputSize.height} maxSide={960} interactiveImageLayerIndexes={[]} onError={toast.error} />{!showOriginal && pointPicking && <span className="only-your-color-point-hint">点击要保留色彩的主体</span>}</div>
          : activeAsset && isImage ? <img className="only-your-color-source-fallback" src={assetSourceUrl(activeAsset)} alt="" />
            : <div className="only-your-color-empty"><ScanSearch size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要突出色彩主体的图片</span></div>}
    </div>
    <aside className="only-your-color-panel"><div className="only-your-color-panel-head"><strong>效果设置</strong><span>主体保留原色，背景转为黑白</span></div>
      <div className="only-your-color-options"><span>智能选择</span><SegmentedControl ariaLabel="智能选择质量" value={subjectModel} options={[{ value: 'fast', label: '快速' }, { value: 'precise', label: '精准' }]} onChange={changeSubjectModel} /><div className="only-your-color-detect-actions"><Button variant="secondary" size="compact" icon={<ScanSearch size={14} />} disabled={!isImage || segmenting} onClick={() => void segmentSubject()}>重新识别</Button><Button variant={pointPicking ? 'primary' : 'secondary'} size="compact" disabled={!isImage || segmenting} onClick={() => setPointPicking(true)}>点选主体</Button></div>{segmenting && <div className="only-your-color-loading" role="status"><LoadingIndicator /><div><strong>{progress || '正在识别'}</strong><span>{subjectModel === 'precise' ? '精准识别' : '快速识别'}处理中</span></div></div>}{pointPicking && !segmenting && <span className="only-your-color-status">在预览图中点击需要保留色彩的区域</span>}<ParamSlider label="主体饱和度" value={subjectSaturation} min={-100} max={100} onChange={setSubjectSaturation} /><ParamSlider label="主体鲜艳度" value={subjectVibrance} min={-100} max={100} onChange={setSubjectVibrance} /><ParamSlider label="背景黑白强度" value={intensity} min={0} max={100} onChange={setIntensity} /></div>
      <div className="only-your-color-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置效果" aria-label="重置效果" onClick={() => { setIntensity(DEFAULT_ONLY_YOUR_COLOR_INTENSITY); setSubjectSaturation(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION); setSubjectVibrance(DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE) }} /><Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!activeMaskPath || exporting} onClick={() => void exportEffect()}>{exporting ? '导出中' : '导出图片'}</Button></div>
    </aside>
    <div className="only-your-color-media-strip"><WorkspaceMediaStrip /></div>
  </section>
}
