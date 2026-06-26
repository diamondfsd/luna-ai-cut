import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion } from 'lucide-react'

import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkOverlay } from './WatermarkOverlay'
import { getContainRect, WATERMARK_MARGIN_X_RATIO, WATERMARK_MARGIN_Y_RATIO } from '../shared/watermark'
import type { LunaFile, WatermarkSettings } from '../shared/types'

interface MediaPreviewPanelProps {
  files: LunaFile[]
  currentFile: LunaFile
  displaySource: string | null
  onFileChange: (file: LunaFile) => void
  watermarkSettings?: WatermarkSettings
}

/** 水印图片原始尺寸 */
const WM_IMAGE = { width: 2560, height: 400 }

export function MediaPreviewPanel({
  files,
  currentFile,
  displaySource,
  onFileChange,
  watermarkSettings,
}: MediaPreviewPanelProps) {
  const thumbStripRef = useRef<HTMLDivElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })

  // 监听舞台尺寸
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.contentBoxSize[0] ?? entry.contentBoxSize
        setStageSize({ width: inlineSize, height: blockSize })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const showWatermark = watermarkSettings !== undefined

  const currentFileId = currentFile.id

  const [hasPrevious, hasNext] = useMemo(() => {
    const idx = files.findIndex((f) => f.id === currentFileId)
    return [idx > 0, idx >= 0 && idx < files.length - 1]
  }, [files, currentFileId])

  function navigateFile(direction: -1 | 1): void {
    const idx = files.findIndex((f) => f.id === currentFileId)
    if (idx < 0) return
    const next = idx + direction
    if (next < 0 || next >= files.length) return
    onFileChange(files[next])
  }

  // 计算水印布局（与后端一致：传感器宽算尺寸，展示方向算边距/位置，缩放至屏幕）
  let wmLayout: { x: number; y: number; width: number; height: number } | null = null
  if (showWatermark && watermarkSettings && stageSize.width > 0 && contentSize.width > 0) {
    const cw = contentSize.width
    const ch = contentSize.height
    const rect = getContainRect(stageSize.width, stageSize.height, cw, ch)
    if (rect.width > 0 && rect.height > 0) {
      const sensorW = Math.max(cw, ch)
      const wmAspect = WM_IMAGE.height / WM_IMAGE.width
      const pct = watermarkSettings.watermarkPercent / 100
      const targetW = Math.min(Math.round(sensorW * pct), WM_IMAGE.width)
      const targetH = Math.round(targetW * wmAspect)
      const mx = Math.round(cw * WATERMARK_MARGIN_X_RATIO)
      const my = Math.round(ch * WATERMARK_MARGIN_Y_RATIO)

      const [vPos, hPos] = watermarkSettings.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
      const imgX = hPos === 'left' ? mx : hPos === 'right' ? cw - targetW - mx : Math.round((cw - targetW) / 2)
      const imgY = vPos === 'bottom' ? ch - targetH - my : my

      const scale = rect.scale
      wmLayout = {
        x: Math.round(rect.x + imgX * scale),
        y: Math.round(rect.y + imgY * scale),
        width: Math.round(targetW * scale),
        height: Math.round(targetH * scale),
      }
    }
  }

  return (
    <div className="preview-stage-col">
      <div className="preview-stage" ref={stageRef}>
        {currentFile.kind === 'image' && displaySource ? (
          <div className="preview-media-wrapper">
            <div className="preview-media-inner">
              <img
                ref={imgRef}
                src={displaySource}
                alt={currentFile.name}
                onLoad={(e) => {
                  const img = e.currentTarget
                  setContentSize({ width: img.naturalWidth, height: img.naturalHeight })
                }}
                style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', width: 'auto', height: 'auto' }}
              />
            </div>
          </div>
        ) : currentFile.kind === 'video' && displaySource ? (
          <div className="preview-media-wrapper">
            <div className="preview-media-inner">
              <video
                src={displaySource}
                controls
                autoPlay
                style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget
                  setContentSize({ width: v.videoWidth, height: v.videoHeight })
                }}
              />
            </div>
          </div>
        ) : (
          <div className="unknown-preview">
            <FileQuestion size={48} />
            <span>无法预览</span>
          </div>
        )}

        {wmLayout && (
          <WatermarkOverlay
            settings={watermarkSettings!}
            kind={currentFile.kind === 'video' ? 'video' : 'image'}
            x={wmLayout.x}
            y={wmLayout.y}
            width={wmLayout.width}
            height={wmLayout.height}
            className="watermark-overlay"
          />
        )}

        {hasPrevious && (
          <button className="preview-nav previous" onClick={() => navigateFile(-1)} title="上一个">
            <ChevronLeft size={24} />
          </button>
        )}
        {hasNext && (
          <button className="preview-nav next" onClick={() => navigateFile(1)} title="下一个">
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      <PreviewThumbnailStrip
        activeThumbRef={activeThumbRef}
        currentFileId={currentFileId}
        files={files}
        stripRef={thumbStripRef}
        onFileChange={onFileChange}
      />
    </div>
  )
}
