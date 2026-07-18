import { ArrowLeft, Download, RotateCcw, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ExportSettingsDialog } from '../../../components/ExportSettingsDialog'
import { MultipleLayerVideoPreviewLrcRender } from '../../../components/MultipleLayerVideoPreviewLrcRender'
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
import { loadCreativeImageSize } from '../shared/creativeMedia'
import { buildPixelStretchLayers } from './pixelStretchLayers'
import './pixel-stretch.css'

const DEFAULT_PRESET = 'horizon' as const
const DEFAULT_INTENSITY = 64
const IMAGE_DURATION = 5

export function PixelStretchCreative({ onBack }: { onBack: () => void }) {
  const media = useWorkspaceMedia()
  const edit = useWorkspaceEdit()
  const activeAsset = media.activeMedia
  const allowWatermark = useLunaUltraWatermark(activeAsset)
  const saved = media.currentProject?.creative?.pixelStretch
  const [preset, setPreset] = useState<WorkspacePixelStretchState['preset']>(saved?.preset ?? DEFAULT_PRESET)
  const [intensity, setIntensity] = useState(saved?.intensity ?? DEFAULT_INTENSITY)
  const [maskPath, setMaskPath] = useState<string | null>(saved?.maskAssetId === activeAsset?.id ? saved?.maskPath ?? null : null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null)
  const [segmenting, setSegmenting] = useState(false)
  const [progress, setProgress] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const requestRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingProjectRef = useRef(media.currentProject)
  const isImage = activeAsset?.kind === 'image'

  useEffect(() => {
    setPreset(saved?.preset ?? DEFAULT_PRESET)
    setIntensity(saved?.intensity ?? DEFAULT_INTENSITY)
    // 仅在切换项目时恢复创意状态，避免每次暂存参数时重置面板。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.currentProject?.id])

  useEffect(() => {
    setMaskPath(saved?.maskAssetId === activeAsset?.id ? saved?.maskPath ?? null : null)
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
    const project = media.currentProject
    if (!project) return
    const nextProject = {
      ...project,
      creative: {
        ...project.creative,
        pixelStretch: {
          preset,
          intensity,
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
  }, [activeAsset?.id, intensity, maskPath, preset])

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
  const effectLayers = useMemo(() => maskPath ? buildPixelStretchLayers({ layers: baseLayers, maskPath, preset, intensity }) : [], [baseLayers, intensity, maskPath, preset])

  const segmentSubject = useCallback(async () => {
    if (!activeAsset || !media.currentProject || activeAsset.kind !== 'image' || segmenting) return
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setSegmenting(true)
    setProgress('正在准备主体识别')
    const unsubscribe = window.luna.onWorkspaceSegmentationProgress((event) => {
      if (event.requestId === requestId) setProgress(event.label)
    })
    try {
      const result = await window.luna.workspace.segmentImage({ requestId, filePath: activeAsset.path, targetId: 'subject', modelId: 'rmbg-1.4' })
      if (requestRef.current !== requestId) return
      const savedMask = await window.luna.workspace.saveColorMask(
        media.currentProject.id,
        activeAsset.id,
        result.width,
        result.height,
        result.bytes,
        1,
      )
      if (requestRef.current !== requestId) return
      setMaskPath(savedMask.path)
      toast.success('主体已识别，可调整拉伸方式')
    } catch (error) {
      if (requestRef.current === requestId) toast.error(error instanceof Error ? error.message : '主体识别失败，请重试')
    } finally {
      unsubscribe()
      if (requestRef.current === requestId) {
        requestRef.current = null
        setSegmenting(false)
        setProgress('')
      }
    }
  }, [activeAsset, media.currentProject, segmenting])

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

  return <section className="pixel-stretch-page">
    <header className="pixel-stretch-toolbar"><Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={onBack}>创意列表</Button><span>像素拉伸</span></header>
    <div className="pixel-stretch-preview">
      {activeAsset && !isImage ? <div className="pixel-stretch-empty"><ScanSearch size={28} /><strong>请选择图片素材</strong><span>像素拉伸目前支持图片素材</span></div>
        : effectLayers.length && outputSize ? <div className="pixel-stretch-stage" style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}><MultipleLayerVideoPreviewLrcRender className="pixel-stretch-canvas" layers={effectLayers} canvasWidth={outputSize.width} canvasHeight={outputSize.height} decodeQuality={1} interactiveImageLayerIndexes={[]} onError={toast.error} /></div>
          : <div className="pixel-stretch-empty"><ScanSearch size={28} /><strong>{activeAsset ? '先识别画面主体' : '选择一张图片素材'}</strong><span>{activeAsset ? '识别后会保留主体，并拉伸背景像素' : '在下方素材栏中选择需要制作效果的图片'}</span></div>}
    </div>
    <aside className="pixel-stretch-panel"><div className="pixel-stretch-panel-head"><strong>效果设置</strong><span>主体保持清晰，背景按预设延展为像素流</span></div>
      <div className="pixel-stretch-options"><span>拉伸方式</span><SegmentedControl ariaLabel="像素拉伸方式" value={preset} options={[{ value: 'horizon', label: '横向流动' }, { value: 'vertical', label: '纵向流动' }, { value: 'burst', label: '交错爆发' }]} onChange={setPreset} />
        <ParamSlider label="拉伸强度" value={intensity} min={20} max={100} onChange={setIntensity} />
      </div>
      <div className="pixel-stretch-actions"><div className="pixel-stretch-tool-actions"><IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={() => { setPreset(DEFAULT_PRESET); setIntensity(DEFAULT_INTENSITY) }} />
        {maskPath && <IconButton variant="ghost" size="mini" icon={<ScanSearch size={14} />} title="重新识别主体" aria-label="重新识别主体" disabled={segmenting} onClick={() => void segmentSubject()} />}</div>
        <div>{!maskPath ? <Button variant="primary" size="compact" icon={<ScanSearch size={14} />} disabled={!isImage || segmenting} onClick={() => void segmentSubject()}>{segmenting ? progress || '识别中' : '识别主体'}</Button> : <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={exporting} onClick={() => setExportOpen(true)}>{exporting ? '加入中' : '生成视频'}</Button>}</div>
      </div>
    </aside>
    <div className="pixel-stretch-media-strip"><WorkspaceMediaStrip /></div>
    <ExportSettingsDialog open={exportOpen} tone="dark" onOpenChange={setExportOpen} title="生成像素拉伸视频" description="设置生成视频的分辨率、码率和帧率" loading={exporting} confirmLabel="开始生成" confirmLoadingLabel="生成中..." onConfirm={exportEffect} />
  </section>
}
