import { ArrowLeft, Download, RotateCcw, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { LrcRender } from '../../../components/LrcRender'
import { resolveExportConfig } from '../../../components/previewStageExport'
import { buildCompositionFromPreviewLayers } from '../../../components/renderComposition'
import type { MediaMetadata, PreviewLayer, VideoExportSettings, WorkspacePixelStretchState } from '../../../shared/types'
import { Button, IconButton, SegmentedControl, toast } from '../../../ui'
import { useLunaUltraWatermark } from '../../../hooks/useLunaUltraWatermark'
import { ParamSlider } from '../../components/ParamSlider'
import { WorkspaceMediaStrip } from '../../components/WorkspaceMediaStrip'
import { useWorkspaceEdit } from '../../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../../context/WorkspaceMediaContext'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { assetSourceUrl, loadCreativeImageSize } from '../shared/creativeMedia'
import { buildPixelStretchLayers, erodeMaskOnePixel, subjectBoundsFromMask, type SubjectBounds } from './pixelStretchLayers'
import './pixel-stretch.css'

const DEFAULT_PRESET = 'right' as const
const DEFAULT_INTENSITY = 64
const DEFAULT_ANGLE = 0
const DEFAULT_SAMPLE_POSITION = 50
const DEFAULT_RIBBON_SIZE = 100
const IMAGE_DURATION = 5

function normalizePreset(value: unknown): WorkspacePixelStretchState['preset'] {
  if (value === 'left' || value === 'right' || value === 'top' || value === 'bottom' || value === 'horizontal' || value === 'vertical') return value
  if (value === 'horizon') return 'right'
  return value === 'burst' ? 'horizontal' : DEFAULT_PRESET
}

export function PixelStretchCreative({ onBack }: { onBack: () => void }) {
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const activeAsset = media.activeMedia
  const projectId = media.currentProject?.id
  const allowWatermark = useLunaUltraWatermark(activeAsset)
  const saved = media.currentProject?.creative?.pixelStretch
  const [preset, setPreset] = useState<WorkspacePixelStretchState['preset']>(normalizePreset(saved?.preset))
  const [intensity, setIntensity] = useState(saved?.intensity ?? DEFAULT_INTENSITY)
  const [angle, setAngle] = useState(saved?.angle ?? DEFAULT_ANGLE)
  const [samplePosition, setSamplePosition] = useState(saved?.samplePosition ?? DEFAULT_SAMPLE_POSITION)
  const [ribbonSize, setRibbonSize] = useState(saved?.ribbonSize ?? DEFAULT_RIBBON_SIZE)
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskAssetId === activeAsset?.id ? saved?.maskPath ?? null : null)
  const [subjectBounds, setSubjectBounds] = useState<SubjectBounds | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const [pointPicking, setPointPicking] = useState(false)
  const [showSampleGuide, setShowSampleGuide] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const requestRef = useRef<string | null>(null)
  const automaticAttemptRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const isImage = activeAsset?.kind === 'image'
  const isHorizontalPreset = preset === 'left' || preset === 'right' || preset === 'horizontal'

  useEffect(() => {
    setPreset(normalizePreset(saved?.preset))
    setIntensity(saved?.intensity ?? DEFAULT_INTENSITY)
    setAngle(saved?.angle ?? DEFAULT_ANGLE)
    setSamplePosition(saved?.samplePosition ?? DEFAULT_SAMPLE_POSITION)
    setRibbonSize(saved?.ribbonSize ?? DEFAULT_RIBBON_SIZE)
    // 仅在切换项目时恢复创意状态，避免每次暂存参数时重置面板。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.currentProject?.id])

  useEffect(() => {
    setMaskPath(saved?.maskAssetId === activeAsset?.id ? saved?.maskPath ?? null : null)
    setSubjectBounds(null)
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
  }, [activeAsset, saved?.maskAssetId, saved?.maskPath])

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
  }, [activeAsset?.id])

  useEffect(() => {
    if (!maskPath || !projectId) {
      setSubjectBounds(null)
      return
    }
    let cancelled = false
    window.luna.workspace.loadColorMask(projectId, maskPath).then((loaded) => {
      if (cancelled) return
      const bounds = subjectBoundsFromMask(new Uint8Array(loaded.bytes), loaded.width, loaded.height)
      if (!bounds) throw new Error('主体蒙版为空')
      setSubjectBounds(bounds)
    }).catch(() => {
      if (!cancelled) {
        setMaskPath(null)
        setSubjectBounds(null)
      }
    })
    return () => { cancelled = true }
  }, [maskPath, projectId])

  useEffect(() => {
    const project = media.currentProject
    if (!project) return
    const nextProject = {
      ...project,
      creative: {
        ...project.creative,
        pixelStretch: {
          preset,
          intensity,
          angle,
          samplePosition,
          ribbonSize,
          maskPath: maskPath ?? undefined,
          maskAssetId: maskPath ? activeAsset?.id : undefined,
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
  }, [activeAsset?.id, angle, intensity, maskPath, preset, ribbonSize, samplePosition])

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
  const effectLayers = useMemo(() => maskPath && subjectBounds && sourceSize
    ? buildPixelStretchLayers({ layers: baseLayers, maskPath, preset, intensity, angle, samplePosition, ribbonSize, subjectBounds })
    : [], [angle, baseLayers, intensity, maskPath, preset, ribbonSize, samplePosition, sourceSize, subjectBounds])
  const previewLayers = effectLayers.length ? effectLayers : baseLayers

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
        : { requestId, filePath: activeAsset.path, targetId: 'subject', modelId: 'rmbg-1.4' })
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
      setMaskPath(savedMask.path)
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
  }, [activeAsset, media.currentProject, segmenting])

  useEffect(() => {
    if (!isImage || !activeAsset || maskPath || segmenting) return
    if (automaticAttemptRef.current === activeAsset.id) return
    automaticAttemptRef.current = activeAsset.id
    void segmentSubject()
  }, [activeAsset, isImage, maskPath, segmentSubject, segmenting])

  function startPointPicking(): void {
    if (!isImage || segmenting) return
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

  const exportEffect = useCallback(async (config: VideoExportSettings) => {
    if (!activeAsset || !outputSize || !maskPath || exporting) return
    setExportOpen(false)
    setExporting(true)
    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
      const resolved = resolveExportConfig(config, outputSize.width, outputSize.height)
      const composition = buildCompositionFromPreviewLayers(effectLayers, resolved.width, resolved.height, { fps: resolved.fps ?? undefined, duration: IMAGE_DURATION })
      composition.canvas.duration = IMAGE_DURATION
      const stamp = Date.now()
      const name = activeAsset.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'pixel-stretch'
      const outputPath = `${settings.exportDir.replace(/\/$/, '')}/${name}-pixel-stretch-${stamp}.mp4`
      const itemId = `pixel_stretch_${stamp}`
      const task = await window.luna.exportTask.create('像素拉伸', [{ id: itemId, sourcePath: activeAsset.path, outputPath, label: '创意视频' }])
      const api = (window as unknown as {
        lunaRenderCore?: {
          exportCompositionVideo: (
            outputPath: string,
            composition: ReturnType<typeof buildCompositionFromPreviewLayers>,
            fps: number | null,
            duration: number | null,
            hardware: boolean,
            taskId?: string,
            qualityPreset?: string,
            exportTaskId?: string,
            exportItemId?: string,
          ) => Promise<void>
        }
      }).lunaRenderCore
      if (!api) throw new Error('渲染引擎未初始化')
      void api.exportCompositionVideo(outputPath, composition, resolved.fps, IMAGE_DURATION, true, itemId, resolved.qualityPreset, task.id, itemId)
      toast.success('已加入生成任务')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '视频生成失败')
    } finally {
      setExporting(false)
    }
  }, [activeAsset, effectLayers, exporting, maskPath, outputSize])

  const guide = subjectBounds && maskPath ? (isHorizontalPreset
    ? {
        className: 'pixel-stretch-sample-guide is-vertical',
        style: {
          left: `${(subjectBounds.x + subjectBounds.w * samplePosition / 100) * 100}%`,
          top: `${subjectBounds.y * 100}%`,
          height: `${subjectBounds.h * 100}%`,
        },
        label: `X ${samplePosition}%`,
      }
    : {
        className: 'pixel-stretch-sample-guide is-horizontal',
        style: {
          left: `${subjectBounds.x * 100}%`,
          top: `${(subjectBounds.y + subjectBounds.h * samplePosition / 100) * 100}%`,
          width: `${subjectBounds.w * 100}%`,
        },
        label: `Y ${samplePosition}%`,
      }) : null

  return <section className="pixel-stretch-page">
    <header className="pixel-stretch-toolbar"><Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button><span>像素拉伸</span></header>
    <div className="pixel-stretch-preview">
      {activeAsset && !isImage ? <div className="pixel-stretch-empty"><ScanSearch size={28} /><strong>请选择图片素材</strong><span>像素拉伸目前支持图片素材</span></div>
        : previewLayers.length && outputSize ? <div className={`pixel-stretch-stage${pointPicking ? ' is-point-picking' : ''}`} style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }} onClick={handlePreviewClick}><LrcRender className="pixel-stretch-canvas" layers={previewLayers} canvasWidth={outputSize.width} canvasHeight={outputSize.height} interactiveImageLayerIndexes={[]} onError={toast.error} />{showSampleGuide && guide && <div className={guide.className} style={guide.style}><span>{guide.label}</span></div>}{pointPicking && <span className="pixel-stretch-point-hint">点击要保留的主体</span>}</div>
          : activeAsset && isImage ? <img className="pixel-stretch-source-fallback" src={assetSourceUrl(activeAsset)} alt="" />
            : <div className="pixel-stretch-empty"><ScanSearch size={28} /><strong>选择一张图片素材</strong><span>在下方素材栏中选择需要制作效果的图片</span></div>}
    </div>
    <aside className="pixel-stretch-panel"><div className="pixel-stretch-panel-head"><strong>效果设置</strong><span>从主体中心像素延展连续色带</span></div>
      <div className="pixel-stretch-options"><span>主体识别</span><div className="pixel-stretch-detect-actions"><Button variant="secondary" size="compact" icon={<ScanSearch size={14} />} disabled={!isImage || segmenting} onClick={() => void segmentSubject()}>主体</Button><Button variant={pointPicking ? 'primary' : 'secondary'} size="compact" disabled={!isImage || segmenting} onClick={startPointPicking}>点选</Button></div>
        {(segmenting || pointPicking) && <span className="pixel-stretch-detect-status">{segmenting ? progress || '正在识别' : '在预览图中点击需要保留的主体'}</span>}
        <fieldset className="pixel-stretch-effect-controls" disabled={!maskPath || segmenting}>
          <span>拉伸方向</span><SegmentedControl className="pixel-stretch-presets" ariaLabel="像素拉伸方向" value={preset} options={[{ value: 'left', label: '左边' }, { value: 'right', label: '右边' }, { value: 'top', label: '上面' }, { value: 'bottom', label: '下面' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' }]} onChange={setPreset} />
          <div onPointerEnter={() => setShowSampleGuide(true)} onPointerLeave={() => setShowSampleGuide(false)} onFocusCapture={() => setShowSampleGuide(true)} onBlurCapture={() => setShowSampleGuide(false)}>
            <ParamSlider label={`取色${isHorizontalPreset ? '横' : '纵'}坐标`} value={samplePosition} min={0} max={100} step={1} onChange={setSamplePosition} formatValue={(next) => `${next}%`} />
          </div>
          <ParamSlider label={`彩带${isHorizontalPreset ? '高度' : '宽度'}`} value={ribbonSize} min={10} max={200} step={1} onChange={setRibbonSize} formatValue={(next) => `${next}%`} />
          <ParamSlider label="拉伸强度" value={intensity} min={20} max={100} onChange={setIntensity} />
          <ParamSlider label="中轴旋转" value={angle} min={-80} max={80} step={1} onChange={setAngle} formatValue={(next) => `${next}°`} />
        </fieldset>
      </div>
      <div className="pixel-stretch-actions"><div className="pixel-stretch-tool-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={() => { setPreset(DEFAULT_PRESET); setIntensity(DEFAULT_INTENSITY); setAngle(DEFAULT_ANGLE); setSamplePosition(DEFAULT_SAMPLE_POSITION); setRibbonSize(DEFAULT_RIBBON_SIZE) }} /></div>
        <div><Button variant="primary" size="compact" icon={<Download size={14} />} disabled={!maskPath || exporting} onClick={() => setExportOpen(true)}>{exporting ? '加入中' : '生成视频'}</Button></div>
      </div>
    </aside>
    <div className="pixel-stretch-media-strip"><WorkspaceMediaStrip /></div>
    <ExportSettingsDialog open={exportOpen} tone="dark" onOpenChange={setExportOpen} title="生成像素拉伸视频" description="设置生成视频的分辨率、码率和帧率" loading={exporting} confirmLabel="开始生成" confirmLoadingLabel="生成中..." onConfirm={exportEffect} />
  </section>
}
