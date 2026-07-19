import { ArrowLeft, Brush, Download, Eye, EyeOff, RotateCcw, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { LrcRender } from '../../../components/LrcRender'
import type { MediaMetadata, PixelStretchFlowShape, PixelStretchPathPoint, PreviewLayer, WorkspacePixelStretchState } from '../../../shared/types'
import { Button, IconButton, SegmentedControl, toast } from '../../../ui'
import { useLunaUltraWatermark } from '../../../hooks/useLunaUltraWatermark'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { useWorkspaceCanvas } from '../../context/WorkspaceCanvasContext'
import { useWorkspaceMask } from '../../context/WorkspaceMaskContext'
import { MaskOverlay } from '../../mask/MaskOverlay'
import { MaskPanel } from '../../mask/MaskPanel'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { assetSourceUrl, loadCreativeImageSize } from '../shared/creativeMedia'
import { PixelStretchSampleEditor, type PixelStretchSampleEditorValue } from './PixelStretchSampleEditor'
import { PixelStretchPathEditor } from './PixelStretchPathEditor'
import { PixelStretchEffectControls } from './PixelStretchEffectControls'
import { buildPixelStretchLayers, erodeMaskOnePixel, subjectBoundsFromMask, suggestPixelStretchPreset, type SubjectBounds } from './pixelStretchLayers'
import { buildPixelStretchFlowPath } from './pixelStretchPath'
import { PIXEL_STRETCH_MASK_LAYER_ID, pixelStretchMaskLayer } from './pixelStretchMask'
import { exportPixelStretchImage } from './exportPixelStretchImage'
import {
  DEFAULT_PIXEL_STRETCH_ANGLE,
  DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET,
  DEFAULT_PIXEL_STRETCH_PRESET,
  DEFAULT_PIXEL_STRETCH_RANGE_END,
  DEFAULT_PIXEL_STRETCH_RANGE_START,
  DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION,
  DEFAULT_PIXEL_STRETCH_FLOW_CURVE,
  DEFAULT_PIXEL_STRETCH_FLOW_END_WIDTH,
  DEFAULT_PIXEL_STRETCH_FLOW_LENGTH,
  DEFAULT_PIXEL_STRETCH_FLOW_SHAPE,
  DEFAULT_PIXEL_STRETCH_FLOW_WIDTH,
  normalizePixelStretchFlowShape,
  normalizePixelStretchFlowValue,
  normalizePixelStretchOffset,
  normalizePixelStretchPathPoints,
  normalizePixelStretchPercent,
  normalizePixelStretchPreset,
  normalizePixelStretchSubjectModel,
  pixelStretchStateForAsset,
} from './pixelStretchState'
import './pixel-stretch.css'

const DEFAULT_INTENSITY = 100
export function PixelStretchCreative({ onBack }: { onBack: () => void }) {
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const canvas = useWorkspaceCanvas()
  const workspaceMask = useWorkspaceMask()
  const setWorkspaceMaskEditing = workspaceMask.setEditing
  const activeAsset = media.activeMedia
  const projectId = media.currentProject?.id
  const activeAssetId = activeAsset?.id
  const parameterOwnerKey = projectId && activeAssetId ? `${projectId}:${activeAssetId}` : null
  const allowWatermark = useLunaUltraWatermark(activeAsset)
  const saved = pixelStretchStateForAsset(media.currentProject, activeAssetId)
  const [preset, setPreset] = useState<WorkspacePixelStretchState['preset']>(normalizePixelStretchPreset(saved?.preset))
  const [subjectModel, setSubjectModel] = useState<NonNullable<WorkspacePixelStretchState['subjectModel']>>(normalizePixelStretchSubjectModel(saved?.subjectModel))
  const [angle, setAngle] = useState(saved?.angle ?? DEFAULT_PIXEL_STRETCH_ANGLE)
  const [samplePosition, setSamplePosition] = useState(saved?.samplePosition ?? DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION)
  const [sampleEndPosition, setSampleEndPosition] = useState(saved?.sampleEndPosition ?? saved?.samplePosition ?? DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION)
  const legacyRange = normalizePixelStretchPercent(saved?.ribbonSize, 100)
  const [sampleRangeStart, setSampleRangeStart] = useState(normalizePixelStretchPercent(saved?.sampleRangeStart, (100 - legacyRange) / 2))
  const [sampleRangeEnd, setSampleRangeEnd] = useState(normalizePixelStretchPercent(saved?.sampleRangeEnd, (100 + legacyRange) / 2))
  const [sampleControlStartOffset, setSampleControlStartOffset] = useState(normalizePixelStretchOffset(saved?.sampleControlStartOffset))
  const [sampleControlEndOffset, setSampleControlEndOffset] = useState(normalizePixelStretchOffset(saved?.sampleControlEndOffset))
  const [flowShape, setFlowShape] = useState<PixelStretchFlowShape>(normalizePixelStretchFlowShape(saved?.flowShape))
  const [flowLength, setFlowLength] = useState(normalizePixelStretchFlowValue(saved?.flowLength, DEFAULT_PIXEL_STRETCH_FLOW_LENGTH))
  const [flowCurve, setFlowCurve] = useState(normalizePixelStretchFlowValue(saved?.flowCurve, DEFAULT_PIXEL_STRETCH_FLOW_CURVE))
  const [flowWidth, setFlowWidth] = useState(normalizePixelStretchFlowValue(saved?.flowWidth, DEFAULT_PIXEL_STRETCH_FLOW_WIDTH))
  const [flowEndWidth, setFlowEndWidth] = useState(normalizePixelStretchFlowValue(saved?.flowEndWidth, DEFAULT_PIXEL_STRETCH_FLOW_END_WIDTH))
  const [flowPoints, setFlowPoints] = useState<PixelStretchPathPoint[] | undefined>(normalizePixelStretchPathPoints(saved?.flowPoints))
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskPath ?? null)
  const [maskOwnerId, setMaskOwnerId] = useState<string | null>(saved?.maskPath ? activeAssetId ?? null : null)
  const [restoredOwnerKey, setRestoredOwnerKey] = useState(parameterOwnerKey)
  const [subjectBounds, setSubjectBounds] = useState<SubjectBounds | null>(null)
  const [maskData, setMaskData] = useState<{ data: Uint8Array; width: number; height: number } | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const [pointPicking, setPointPicking] = useState(false)
  const [sampleEditing, setSampleEditing] = useState(false)
  const [pathEditing, setPathEditing] = useState(false)
  const [maskEditing, setMaskEditing] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const requestRef = useRef<string | null>(null)
  const automaticAttemptRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const maskLayerOwnerRef = useRef<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const isImage = activeAsset?.kind === 'image'
  const activeMaskPath = maskOwnerId === activeAsset?.id ? maskPath : null
  const isHorizontalPreset = preset === 'left' || preset === 'right' || preset === 'horizontal'
  const creativeMaskLayer = edit.pipeline.colorMasks.find((layer) => layer.id === PIXEL_STRETCH_MASK_LAYER_ID)
  const activeCreativeMaskLayer = creativeMaskLayer?.path === activeMaskPath ? creativeMaskLayer : undefined

  useEffect(() => {
    const restored = pixelStretchStateForAsset(media.currentProject, activeAssetId)
    setPreset(normalizePixelStretchPreset(restored?.preset))
    setSubjectModel(normalizePixelStretchSubjectModel(restored?.subjectModel))
    setAngle(restored?.angle ?? DEFAULT_PIXEL_STRETCH_ANGLE)
    setSamplePosition(restored?.samplePosition ?? DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION)
    setSampleEndPosition(restored?.sampleEndPosition ?? restored?.samplePosition ?? DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION)
    const restoredLegacyRange = normalizePixelStretchPercent(restored?.ribbonSize, 100)
    setSampleRangeStart(normalizePixelStretchPercent(restored?.sampleRangeStart, (100 - restoredLegacyRange) / 2))
    setSampleRangeEnd(normalizePixelStretchPercent(restored?.sampleRangeEnd, (100 + restoredLegacyRange) / 2))
    setSampleControlStartOffset(normalizePixelStretchOffset(restored?.sampleControlStartOffset))
    setSampleControlEndOffset(normalizePixelStretchOffset(restored?.sampleControlEndOffset))
    setFlowShape(normalizePixelStretchFlowShape(restored?.flowShape))
    setFlowLength(normalizePixelStretchFlowValue(restored?.flowLength, DEFAULT_PIXEL_STRETCH_FLOW_LENGTH))
    setFlowCurve(normalizePixelStretchFlowValue(restored?.flowCurve, DEFAULT_PIXEL_STRETCH_FLOW_CURVE))
    setFlowWidth(normalizePixelStretchFlowValue(restored?.flowWidth, DEFAULT_PIXEL_STRETCH_FLOW_WIDTH))
    setFlowEndWidth(normalizePixelStretchFlowValue(restored?.flowEndWidth, DEFAULT_PIXEL_STRETCH_FLOW_END_WIDTH))
    setFlowPoints(normalizePixelStretchPathPoints(restored?.flowPoints))
    setSampleEditing(false)
    setPathEditing(false)
    setMaskEditing(false)
    setShowOriginal(false)
    setRestoredOwnerKey(parameterOwnerKey)
    // 仅在切换素材或项目时恢复创意状态，避免每次暂存参数时重置面板。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parameterOwnerKey])

  useEffect(() => {
    const restoredMaskPath = pixelStretchStateForAsset(media.currentProject, activeAssetId)?.maskPath ?? null
    setMaskPath(restoredMaskPath)
    setMaskOwnerId(restoredMaskPath ? activeAssetId ?? null : null)
    maskLayerOwnerRef.current = null
    setSubjectBounds(null)
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
  // 只在素材或项目真正变化时初始化；项目参数自动保存不应重置预览。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetId, activeAsset?.kind, activeAsset?.path, projectId])

  useEffect(() => {
    setPointPicking(false)
    setSampleEditing(false)
    setMaskEditing(false)
    setWorkspaceMaskEditing(false)
    setSegmenting(false)
    setProgress('')
    automaticAttemptRef.current = null
    return () => {
      const requestId = requestRef.current
      if (!requestId) return
      requestRef.current = null
      void window.luna.workspace.cancelSegmentation(requestId)
    }
  }, [activeAsset?.id, setWorkspaceMaskEditing])

  useEffect(() => {
    if (!creativeMaskLayer?.path || maskLayerOwnerRef.current !== activeAssetId) return
    setMaskOwnerId(activeAssetId ?? null)
    setMaskPath(creativeMaskLayer.path)
  }, [activeAssetId, creativeMaskLayer?.path])

  useEffect(() => () => setWorkspaceMaskEditing(false), [setWorkspaceMaskEditing])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !sourceSize || !maskEditing) return
    const updateMetrics = () => {
      const rect = stage.getBoundingClientRect()
      canvas.setPreviewMetrics({
        imageRect: { x: 0, y: 0, width: rect.width, height: rect.height },
        sourceAspect: sourceSize.width / sourceSize.height,
      })
    }
    updateMetrics()
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [canvas, maskEditing, sourceSize])

  useEffect(() => {
    if (!activeMaskPath || !projectId) {
      setSubjectBounds(null)
      setMaskData(null)
      return
    }
    let cancelled = false
    window.luna.workspace.loadColorMask(projectId, activeMaskPath).then((loaded) => {
      if (cancelled) return
      const data = new Uint8Array(loaded.bytes)
      const boundsData = activeCreativeMaskLayer?.inverted ? data.map((value) => 255 - value) : data
      const bounds = subjectBoundsFromMask(boundsData, loaded.width, loaded.height)
      if (!bounds) throw new Error('主体蒙版为空')
      setSubjectBounds(bounds)
      setMaskData({ data, width: loaded.width, height: loaded.height })
    }).catch(() => {
      if (!cancelled) {
        setMaskPath(null)
        setMaskOwnerId(null)
        setSubjectBounds(null)
        setMaskData(null)
      }
    })
    return () => { cancelled = true }
  }, [activeCreativeMaskLayer?.inverted, activeMaskPath, projectId])

  useEffect(() => {
    const project = media.currentProject
    if (!project || !activeAssetId || restoredOwnerKey !== parameterOwnerKey) return
    const nextState: WorkspacePixelStretchState = {
      preset,
      subjectModel,
      intensity: DEFAULT_INTENSITY,
      angle,
      samplePosition,
      sampleEndPosition,
      sampleLocked: false,
      ribbonSize: Math.abs(sampleRangeEnd - sampleRangeStart),
      sampleRangeStart,
      sampleRangeEnd,
      sampleControlStartOffset,
      sampleControlEndOffset,
      flowShape,
      flowLength,
      flowCurve,
      flowWidth,
      flowEndWidth,
      flowPoints,
      maskPath: activeMaskPath ?? undefined,
      maskAssetId: activeMaskPath ? activeAssetId : undefined,
    }
    const nextProject = {
      ...project,
      creative: {
        ...project.creative,
        pixelStretch: nextState,
        pixelStretchByAssetId: {
          ...project.creative?.pixelStretchByAssetId,
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
  // 参数变化时延迟保存，避免由项目 Context 刷新再次触发保存。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAssetId, activeMaskPath, angle, flowCurve, flowEndWidth, flowLength, flowPoints, flowShape, flowWidth, parameterOwnerKey, preset, restoredOwnerKey, sampleControlEndOffset, sampleControlStartOffset, sampleEndPosition, samplePosition, sampleRangeEnd, sampleRangeStart, subjectModel])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (pendingProjectRef.current) void window.luna.workspace.saveProject(pendingProjectRef.current).catch(() => undefined)
    if (requestRef.current) void window.luna.workspace.cancelSegmentation(requestRef.current)
  }, [])

  const outputSize = useMemo(() => sourceSize ? outputSizeForTransform(sourceSize, edit.pipeline.transform) : null, [edit.pipeline.transform, sourceSize])
  const baseLayers = useMemo<PreviewLayer[]>(() => {
    if (!activeAsset || !sourceSize) return []
    return buildWorkspaceExportLayers(activeAsset.path, sourceSize, edit.pipeline, metadata, allowWatermark)
  }, [activeAsset, allowWatermark, edit.pipeline, metadata, sourceSize])
  const effectLayers = useMemo(() => activeMaskPath && subjectBounds && sourceSize
    ? buildPixelStretchLayers({ layers: baseLayers, maskPath: activeMaskPath, preset, angle, samplePosition, sampleEndPosition, sampleRangeStart, sampleRangeEnd, sampleControlStartOffset, sampleControlEndOffset, maskInverted: activeCreativeMaskLayer?.inverted, maskFeather: activeCreativeMaskLayer?.feather, subjectBounds, sourceAspect: sourceSize.width / sourceSize.height, flowShape, flowLength, flowCurve, flowWidth, flowEndWidth, flowPoints })
    : [], [activeCreativeMaskLayer?.feather, activeCreativeMaskLayer?.inverted, activeMaskPath, angle, baseLayers, flowCurve, flowEndWidth, flowLength, flowPoints, flowShape, flowWidth, preset, sampleControlEndOffset, sampleControlStartOffset, sampleEndPosition, samplePosition, sampleRangeEnd, sampleRangeStart, sourceSize, subjectBounds])
  const previewLayers = showOriginal ? baseLayers : effectLayers.length ? effectLayers : baseLayers
  const resolvedFlowPoints = useMemo(() => subjectBounds && sourceSize ? buildPixelStretchFlowPath({ shape: flowShape, preset, length: flowLength, curve: flowCurve, aspect: sourceSize.width / sourceSize.height, bounds: subjectBounds, start: effectLayers[1]?.pixelStretch ? { x: effectLayers[1].pixelStretch.centerX ?? 0.5, y: effectLayers[1].pixelStretch.centerY ?? 0.5 } : undefined, startInset: (effectLayers[1]?.pixelStretch?.pathStartWidth ?? 0) / 2, customPoints: flowPoints }) : undefined, [effectLayers, flowCurve, flowLength, flowPoints, flowShape, preset, sourceSize, subjectBounds])

  function changeSubjectModel(value: NonNullable<WorkspacePixelStretchState['subjectModel']>): void {
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
      const insetMask = erodeMaskOnePixel(new Uint8Array(result.bytes), result.width, result.height)
      const bounds = subjectBoundsFromMask(insetMask, result.width, result.height)
      if (!bounds) throw new Error(point ? '点选区域没有有效主体' : '未识别到主体，可使用点选')
      const savedMask = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        activeAsset.id,
        result.width,
        result.height,
        insetMask,
        1,
      )
      if (requestRef.current !== requestId) return
      setSubjectBounds(bounds)
      setMaskData({ data: insetMask, width: result.width, height: result.height })
      setMaskOwnerId(activeAsset.id)
      setMaskPath(savedMask.path)
      if (!activeMaskPath && sourceSize) setPreset(suggestPixelStretchPreset(bounds, sourceSize.width / sourceSize.height))
      if (creativeMaskLayer) {
        maskLayerOwnerRef.current = activeAsset.id
        edit.commitPatch({
          colorMasks: edit.pipeline.colorMasks.map((layer) => layer.id === PIXEL_STRETCH_MASK_LAYER_ID
            ? pixelStretchMaskLayer(savedMask.path, result.width, result.height, layer)
            : layer),
        })
      }
      setPointPicking(false)
      toast.success(point ? '已更新选中主体' : '主体已识别，可调整拉伸方式')
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
  }, [activeAsset, activeMaskPath, creativeMaskLayer, edit, media.currentProject, segmenting, sourceSize, subjectModel])

  useEffect(() => {
    if (!isImage || !activeAsset || activeMaskPath || segmenting || restoredOwnerKey !== parameterOwnerKey) return
    if (automaticAttemptRef.current === activeAsset.id) return
    automaticAttemptRef.current = activeAsset.id
    void segmentSubject()
  }, [activeAsset, activeMaskPath, isImage, parameterOwnerKey, restoredOwnerKey, segmentSubject, segmenting])

  function startPointPicking(): void {
    if (!isImage || segmenting) return
    setSampleEditing(false)
    setMaskEditing(false)
    setPointPicking(true)
  }

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
      await exportPixelStretchImage({ asset: activeAsset, layers: effectLayers, width: outputSize.width, height: outputSize.height })
      toast.success('图片已导出')
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片导出失败'
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }, [activeAsset, activeMaskPath, effectLayers, exporting, outputSize])

  const sampleEditorValue: PixelStretchSampleEditorValue = {
    rangeStart: sampleRangeStart,
    rangeEnd: sampleRangeEnd,
    anchorStart: samplePosition,
    anchorEnd: sampleEndPosition,
    controlStartOffset: sampleControlStartOffset,
    controlEndOffset: sampleControlEndOffset,
  }

  function updateSampleEditor(key: keyof PixelStretchSampleEditorValue, value: number): void {
    if (key === 'rangeStart') setSampleRangeStart(value)
    else if (key === 'rangeEnd') setSampleRangeEnd(value)
    else if (key === 'anchorStart') setSamplePosition(value)
    else if (key === 'anchorEnd') setSampleEndPosition(value)
    else if (key === 'controlStartOffset') setSampleControlStartOffset(value)
    else setSampleControlEndOffset(value)
  }

  const sampleCoordinate = (samplePosition + sampleEndPosition) / 2
  const sampleCoordinateHalfSpan = Math.abs(sampleEndPosition - samplePosition) / 2

  function moveSampleCoordinate(value: number): void {
    const next = Math.max(sampleCoordinateHalfSpan, Math.min(100 - sampleCoordinateHalfSpan, value))
    const offset = next - sampleCoordinate
    setSamplePosition(samplePosition + offset)
    setSampleEndPosition(sampleEndPosition + offset)
  }

  function resetSampleEditor(): void {
    setSamplePosition(DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION)
    setSampleEndPosition(DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION)
    setSampleRangeStart(DEFAULT_PIXEL_STRETCH_RANGE_START)
    setSampleRangeEnd(DEFAULT_PIXEL_STRETCH_RANGE_END)
    setSampleControlStartOffset(DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET)
    setSampleControlEndOffset(DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET)
  }

  function changeFlowShape(value: PixelStretchFlowShape): void {
    setFlowShape(value)
    setSampleEditing(false)
    setPathEditing(value === 'custom')
  }

  function changePreset(value: WorkspacePixelStretchState['preset']): void {
    setPreset(value)
    if (flowShape === 'custom') setFlowPoints(undefined)
  }

  function resetEffect(): void {
    setPreset(DEFAULT_PIXEL_STRETCH_PRESET)
    setAngle(DEFAULT_PIXEL_STRETCH_ANGLE)
    setFlowShape(DEFAULT_PIXEL_STRETCH_FLOW_SHAPE)
    setFlowLength(DEFAULT_PIXEL_STRETCH_FLOW_LENGTH)
    setFlowCurve(DEFAULT_PIXEL_STRETCH_FLOW_CURVE)
    setFlowWidth(DEFAULT_PIXEL_STRETCH_FLOW_WIDTH)
    setFlowEndWidth(DEFAULT_PIXEL_STRETCH_FLOW_END_WIDTH)
    setFlowPoints(undefined)
    setPathEditing(false)
    resetSampleEditor()
  }

  function openMaskEditor(): void {
    if (!activeMaskPath || !maskData) return
    maskLayerOwnerRef.current = activeAssetId ?? null
    const layer = pixelStretchMaskLayer(activeMaskPath, maskData.width, maskData.height, creativeMaskLayer)
    edit.commitPatch({
      colorMasks: [...edit.pipeline.colorMasks.filter((item) => item.id !== PIXEL_STRETCH_MASK_LAYER_ID), layer],
    })
    setPointPicking(false)
    setSampleEditing(false)
    setPathEditing(false)
    setMaskEditing(true)
    workspaceMask.setActiveLayerId(PIXEL_STRETCH_MASK_LAYER_ID)
    workspaceMask.setManualTool('move')
    workspaceMask.setSemanticPicking(false)
    workspaceMask.setShowOverlay(true)
    workspaceMask.setEditing(true)
  }

  function closeMaskEditor(): void {
    workspaceMask.setEditing(false)
    setMaskEditing(false)
  }

  return <section className="pixel-stretch-page">
    <header className="pixel-stretch-toolbar"><Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button><span>像素拉伸</span><Button className="pixel-stretch-compare" variant={showOriginal ? 'toolbar-primary' : 'toolbar'} size="compact" icon={showOriginal ? <EyeOff size={14} /> : <Eye size={14} />} disabled={!isImage || !sourceSize} aria-pressed={showOriginal} title="按住查看原图" onPointerDown={() => setShowOriginal(true)} onPointerUp={() => setShowOriginal(false)} onPointerCancel={() => setShowOriginal(false)} onPointerLeave={() => setShowOriginal(false)} onBlur={() => setShowOriginal(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') setShowOriginal(true) }} onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') setShowOriginal(false) }}>对比</Button></header>
    <div className="pixel-stretch-preview">
      {activeAsset && !isImage ? <div className="pixel-stretch-empty"><ScanSearch size={28} /><strong>请选择图片素材</strong><span>像素拉伸目前支持图片素材</span></div>
        : previewLayers.length && outputSize ? <div ref={stageRef} className={`pixel-stretch-stage${pointPicking ? ' is-point-picking' : ''}`} style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }} onClick={handlePreviewClick}><LrcRender className="pixel-stretch-canvas" layers={previewLayers} canvasWidth={outputSize.width} canvasHeight={outputSize.height} maxSide={960} interactiveImageLayerIndexes={[]} onError={toast.error} />{!showOriginal && sampleEditing && subjectBounds && <PixelStretchSampleEditor bounds={subjectBounds} horizontal={isHorizontalPreset} value={sampleEditorValue} onChange={updateSampleEditor} />}{!showOriginal && pathEditing && flowShape === 'custom' && resolvedFlowPoints && sourceSize && <PixelStretchPathEditor points={resolvedFlowPoints} center={{ x: effectLayers[1]?.pixelStretch?.centerX ?? 0.5, y: effectLayers[1]?.pixelStretch?.centerY ?? 0.5 }} angle={angle} aspect={sourceSize.width / sourceSize.height} onChange={setFlowPoints} />}{!showOriginal && maskEditing && workspaceMask.editing && <MaskOverlay />}{!showOriginal && pointPicking && <span className="pixel-stretch-point-hint">点击要保留的主体</span>}</div>
          : activeAsset && isImage ? <img className="pixel-stretch-source-fallback" src={assetSourceUrl(activeAsset)} alt="" />
            : <div className="pixel-stretch-empty"><ScanSearch size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要制作效果的图片</span></div>}
    </div>
    <aside className="pixel-stretch-panel"><div className="pixel-stretch-panel-head"><strong>效果设置</strong><span>从主体中心像素延展连续色带</span></div>
      {maskEditing ? <div className="pixel-stretch-full-mask-editor"><Button variant="primary" size="compact" onClick={closeMaskEditor}>完成蒙版调整</Button><MaskPanel /></div>
        : <div className="pixel-stretch-options"><span>主体识别</span><fieldset className="pixel-stretch-model-select"><SegmentedControl className="pixel-stretch-presets pixel-stretch-models" ariaLabel="主体识别质量" value={subjectModel} options={[{ value: 'fast', label: '快速' }, { value: 'precise', label: '精准' }]} onChange={changeSubjectModel} /></fieldset><div className="pixel-stretch-detect-actions"><Button variant="secondary" size="compact" icon={<ScanSearch size={14} />} disabled={!isImage || segmenting} onClick={() => void segmentSubject()}>主体</Button><Button variant={pointPicking ? 'primary' : 'secondary'} size="compact" disabled={!isImage || segmenting} onClick={startPointPicking}>点选</Button></div>
          {(segmenting || pointPicking) && <span className="pixel-stretch-detect-status">{segmenting ? progress || '正在识别' : '在预览图中点击需要保留的主体'}</span>}
          <Button variant="secondary" size="compact" icon={<Brush size={14} />} disabled={!maskData || segmenting} onClick={openMaskEditor}>调整蒙版</Button>
          <PixelStretchEffectControls disabled={!activeMaskPath || segmenting} preset={preset} flowShape={flowShape} sampleEditing={sampleEditing} pathEditing={pathEditing} sampleCoordinate={sampleCoordinate} sampleCoordinateHalfSpan={sampleCoordinateHalfSpan} angle={angle} flowLength={flowLength} flowCurve={flowCurve} flowWidth={flowWidth} flowEndWidth={flowEndWidth} horizontal={isHorizontalPreset} onPresetChange={changePreset} onFlowShapeChange={changeFlowShape} onToggleSampleEditing={() => { setPointPicking(false); setPathEditing(false); setSampleEditing((editing) => !editing) }} onTogglePathEditing={() => { setPointPicking(false); setSampleEditing(false); if (flowShape !== 'custom') { setFlowPoints(resolvedFlowPoints); setFlowShape('custom'); setPathEditing(true) } else setPathEditing((editing) => !editing) }} onResetSample={resetSampleEditor} onSampleCoordinateChange={moveSampleCoordinate} onAngleChange={setAngle} onFlowLengthChange={setFlowLength} onFlowCurveChange={setFlowCurve} onFlowWidthChange={setFlowWidth} onFlowEndWidthChange={setFlowEndWidth} />
        </div>}
      <div className="pixel-stretch-actions"><div className="pixel-stretch-tool-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={resetEffect} /></div>
        <div><Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!activeMaskPath || exporting} onClick={() => void exportEffect()}>{exporting ? '导出中' : '导出图片'}</Button></div>
      </div>
    </aside>
    <div className="pixel-stretch-media-strip"><WorkspaceMediaStrip /></div>
  </section>
}
