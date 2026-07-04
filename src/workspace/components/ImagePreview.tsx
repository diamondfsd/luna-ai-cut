import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { LivePhotoBadge, LoadingIndicator, Tooltip } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { createDefaultPipeline } from '../shared/editPipeline'
import { buildColorLutParams, colorLutKey } from '../shared/colorLut'
import { useCanvasEngine } from '../hooks/useCanvasEngine'
import { useViewport } from '../hooks/useViewport'
import { WorkspaceVideoControls } from './WorkspaceVideoControls'
// Watermark（自包含，不依赖 context）
import { WatermarkOverlay } from '../../components/WatermarkOverlay'
import { resolveWatermarkRatios } from '../../shared/watermark/layoutConfig'
import { loadWatermarkImage } from '../../shared/watermarkAssets'
import type { WatermarkImageInfo } from '../../shared/watermarkAssets'

// ── Public handle 类型 ──

export interface ImagePreviewHandle {
  /** WebGL 画布 ref（用于导出等操作） */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** 当前图片在画布中的显示区域（像素坐标） */
  imageRect: { x: number; y: number; width: number; height: number }
  /** 是否可以渲染 */
  canRender: boolean
  /** 当前加载的文件路径 */
  loadedMediaPath: string | null
}

// ── Props ──

export interface ImagePreviewProps {
  /** 文件路径（必需） */
  filePath: string
  /** 文件名（显示用） */
  name?: string
  /** 是否为 Live Photo */
  isLivePhoto?: boolean
  /** 调色管线（不传则使用默认管线） */
  pipeline?: EditPipeline
  /** 水印设置（不传则取 pipeline.watermark） */
  watermark?: EditPipeline['watermark']
  /** 裁剪模式（仅控制 CSS 类名） */
  cropActive?: boolean
  /** 渲染时是否允许使用旧 LUT 过渡（对比模式应为 false） */
  allowStaleLut?: boolean
  /** 双击回调（默认：缩放切换） */
  onDoubleClick?: () => void
  /** 容器 className（默认 workspace-canvas-shell） */
  className?: string
  /** 渲染额外的叠加层 */
  renderOverlay?: () => React.ReactNode
  /** 内部状态变化通知（imageRect / canRender 等） */
  onStateChange?: (state: Pick<ImagePreviewHandle, 'imageRect' | 'canRender' | 'loadedMediaPath'>) => void
}

/**
 * 自包含的图片/视频预览组件。
 *
 * 职责：
 * - WebGL 渲染（通过内部 useCanvasEngine）
 * - 视口拖拽、滚轮缩放
 * - 视频播放控件
 * - Live Photo 播放
 * - 水印叠加
 * - LUT 色彩烘焙
 * - 加载状态 / 错误状态
 *
 * ⚡ 不依赖任何外部 Context Provider，传入 filePath 即可使用。
 */
export const ImagePreview = forwardRef<ImagePreviewHandle, ImagePreviewProps>(function ImagePreview({
  filePath,
  name,
  isLivePhoto = false,
  pipeline: externalPipeline,
  watermark: watermarkProp,
  cropActive = false,
  allowStaleLut = true,
  onDoubleClick,
  className = 'workspace-canvas-shell',
  renderOverlay,
  onStateChange,
}, ref) {
  const resolvedPipeline = externalPipeline ?? createDefaultPipeline()
  const [livePhotoLoading, setLivePhotoLoading] = useState(false)

  // ── Viewport ──
  const viewport = useViewport()

  // ── Canvas engine（内部管理 WebGL 渲染器、媒体加载、视频） ──
  const activeMedia = useMemo(() => ({ path: filePath }), [filePath])
  const canvas = useCanvasEngine({ editorOpen: true, activeMedia })

  const activeMediaReady = Boolean(
    activeMedia && canvas.loadedMediaPath === activeMedia.path && !canvas.imageLoading,
  )

  // ── 暴露 handle ──
  useImperativeHandle(ref, () => ({
    canvasRef: canvas.canvasRef,
    imageRect: canvas.imageRect,
    canRender: canvas.canRender,
    loadedMediaPath: canvas.loadedMediaPath,
  }), [canvas.canvasRef, canvas.imageRect, canvas.canRender, canvas.loadedMediaPath])

  // ── 通知父组件状态变化 ──
  useEffect(() => {
    onStateChange?.({
      imageRect: canvas.imageRect,
      canRender: canvas.canRender,
      loadedMediaPath: canvas.loadedMediaPath,
    })
  })

  // ── 重置视口（媒体切换时） ──
  useEffect(() => { viewport.resetViewport() }, [filePath])

  // ── 3D LUT 加载（放在渲染前，与旧 WorkspacePage 保持一致顺序） ──
  const lutTimerRef = useRef<number | null>(null)
  const lutKey = colorLutKey(resolvedPipeline.color)
  useEffect(() => {
    if (!canvas.canRender) return
    if (lutTimerRef.current) window.clearTimeout(lutTimerRef.current)
    lutTimerRef.current = window.setTimeout(() => {
      const color = resolvedPipeline.color
      if (!color) return
      void canvas.bakeAndLoadLut(buildColorLutParams(color), lutKey)
    }, 80)
    return () => {
      if (lutTimerRef.current) window.clearTimeout(lutTimerRef.current)
    }
  }, [lutKey, canvas.canRender, canvas.bakeAndLoadLut])

  // ── 渲染管线（pipeline / crop / allowStaleLut 变化时触发）。
  //     allowStaleLut 控制新 LUT 烘焙完成前是否用旧 LUT 过渡 ──
  useEffect(() => {
    canvas.render(resolvedPipeline, { cropMode: cropActive, allowStaleLut })
  }, [resolvedPipeline, cropActive, allowStaleLut, canvas.render])

  // ── 双击缩放 ──
  const handleDoubleClick = useCallback(() => {
    if (onDoubleClick) { onDoubleClick(); return }
    if (viewport.zoom > 1) {
      viewport.resetViewport()
    } else {
      viewport.zoomTo(2)
    }
  }, [onDoubleClick, viewport])

  // ── Live Photo 播放 ──
  const handlePlayLivePhoto = useCallback(async () => {
    setLivePhotoLoading(true)
    try {
      const result = await (window as any).luna.previewLivePhoto({
        name: name ?? filePath,
        isLivePhoto: true,
        localPath: filePath,
        downloadFilePath: filePath,
      })
      if (result?.source) {
        await canvas.loadLiveVideo(result.source)
        canvas.playVideo()
      }
    } catch {
      // 静默失败
    } finally {
      setLivePhotoLoading(false)
    }
  }, [filePath, name, canvas])

  // ── 水印 ──
  const watermarkSettings = watermarkProp ?? resolvedPipeline.watermark
  const [wmImage, setWmImage] = useState<WatermarkImageInfo | null>(null)

  useEffect(() => {
    if (!watermarkSettings?.enabled) { setWmImage(null); return }
    let cancelled = false
    loadWatermarkImage(watermarkSettings.style, 'image').then((info) => {
      if (!cancelled) setWmImage(info)
    })
    return () => { cancelled = true }
  }, [watermarkSettings?.enabled, watermarkSettings?.style])

  const wmRender = useMemo(() => {
    if (!watermarkSettings?.enabled || !wmImage || canvas.imageRect.width <= 1 || canvas.imageRect.height <= 1) return null
    const { imageRect } = canvas
    const ratios = resolveWatermarkRatios(null, watermarkSettings.style, imageRect.width, imageRect.height, watermarkSettings.position)
    const widthRatio = ratios?.widthRatio ?? 0.15
    const sensorW = Math.max(imageRect.width, imageRect.height)
    const wmAspect = wmImage.height / wmImage.width
    const targetW = Math.min(Math.round(sensorW * widthRatio), wmImage.width)
    const targetH = Math.round(targetW * wmAspect)
    const [vPos] = watermarkSettings.position.split('-') as ['top' | 'bottom', string]
    const xRatio = ratios?.xRatio ?? 0.03
    const yRatio = ratios?.yRatio ?? 0.03
    const x = Math.round(imageRect.width * xRatio)
    const y = vPos === 'bottom'
      ? Math.round(imageRect.height - targetH - imageRect.height * yRatio)
      : Math.round(imageRect.height * (1 - yRatio))
    return (
      <WatermarkOverlay
        settings={watermarkSettings}
        kind="image"
        x={imageRect.x + x}
        y={imageRect.y + y}
        width={targetW}
        height={targetH}
        className="workspace-watermark-overlay"
      />
    )
  }, [watermarkSettings, wmImage, canvas.imageRect])

  return (
    <section className={className}>
      <div
        ref={canvas.stageRef as React.RefObject<HTMLDivElement>}
        className={`workspace-canvas-stage${!activeMediaReady ? ' loading' : ''}${cropActive ? ' cropping' : ''}${viewport.zoom > 1 && !cropActive ? ' panning' : ''}`}
        onWheel={viewport.handleWheel}
        onPointerDown={viewport.handlePointerDown}
        onPointerMove={viewport.handlePointerMove}
        onPointerUp={viewport.handlePointerUp}
        onPointerCancel={viewport.handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className={`workspace-preview-surface${!activeMediaReady ? ' is-hidden' : ''}`}
          style={{ transform: `translate(${viewport.pan.x}px, ${viewport.pan.y}px) scale(${viewport.zoom})` }}
        >
          <canvas
            ref={canvas.canvasRef as React.RefObject<HTMLCanvasElement>}
            className="workspace-canvas"
          />
          {wmRender}
          {renderOverlay?.()}
        </div>

        {/* 状态叠加层 */}
        {(!activeMediaReady || canvas.imageError || canvas.webglMessage || !activeMedia) && (
          <div className="workspace-stage-status">
            {activeMedia && !canvas.imageError && !canvas.webglMessage && !activeMediaReady && (
              <LoadingIndicator label="加载预览中" />
            )}
            {canvas.imageError && <span>{canvas.imageError}</span>}
            {!canvas.imageError && canvas.webglMessage && <span>{canvas.webglMessage}</span>}
            {!canvas.imageError && !activeMedia && <span>暂无素材</span>}
          </div>
        )}
      </div>

      {/* Live Photo 播放按钮 */}
      {isLivePhoto && activeMediaReady && !canvas.isVideo && (
        <Tooltip content="播放 Live Photo">
          <button
            className="workspace-live-btn"
            type="button"
            disabled={livePhotoLoading}
            onClick={handlePlayLivePhoto}
            aria-label="播放 Live Photo"
          >
            <LivePhotoBadge size={36} />
          </button>
        </Tooltip>
      )}

      {/* 视频播放控件 */}
      {canvas.isVideo && !canvas.isLivePlayback && activeMediaReady && (
        <WorkspaceVideoControls
          playing={canvas.videoPlaying}
          currentTime={canvas.videoCurrentTime}
          duration={canvas.videoDuration}
          onToggle={canvas.toggleVideoPlayback}
          onSeek={canvas.seekVideo}
        />
      )}
    </section>
  )
})
