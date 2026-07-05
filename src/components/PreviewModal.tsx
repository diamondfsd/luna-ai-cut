import { useEffect, useState } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { filePathToPreviewUrl, isImagePath, isVideoPath } from '../lib/fileUtils'
import type { PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { Dialog } from '../ui'
import '../styles/modal.css'

interface PreviewModalProps {
  filePath: string
  filePathList?: string[]
  previewOnly?: boolean
  onClose: () => void
}

export function PreviewModal({
  filePath,
  filePathList,
  previewOnly,
  onClose,
}: PreviewModalProps) {
  // ── 当前预览文件路径 ──
  const [currentFilePath, setCurrentFilePath] = useState(filePath)

  // 外部 filePath 变化时重置
  useEffect(() => {
    setCurrentFilePath(filePath)
  }, [filePath])

  // ── 状态 ──
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkLayers, setWatermarkLayers] = useState<PreviewLayer[]>([])
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null)

  const displaySource = filePathToPreviewUrl(currentFilePath) ?? currentFilePath
  const isVideo = isVideoPath(currentFilePath)
  const isImage = isImagePath(currentFilePath)

  // 获取媒体分辨率用于水印布局匹配
  useEffect(() => {
    if (previewOnly) return // 预览已导出文件不需要分辨率信息
    setMediaSize(null)
    setWatermarkLayers([])
    if (!currentFilePath) return
    let canceled = false
    window.luna.workspace.getMediaResolution(currentFilePath)
      .then(({ width, height }) => {
        if (!canceled) setMediaSize({ w: width, h: height })
      })
      .catch(() => {
        if (!canceled) setMediaSize(null)
      })
    return () => {
      canceled = true
    }
  }, [currentFilePath, previewOnly])

  // WatermarkSettings onChange 回调（仅非 previewOnly 时需要）
  function handleWatermarkChange(_settings: WatermarkSettingsType, layer?: PreviewLayer) {
    setWatermarkLayers(layer ? [layer] : [])
  }

  // Escape 关闭
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <Dialog open variant="fullscreen" onOpenChange={(o) => !o && onClose()}>
      <section className="preview-modal">
        <PreviewModalHeader
          filePath={currentFilePath}
          inspectorOpen={inspectorOpen}
          onSetInspectorOpen={setInspectorOpen}
          onClose={onClose}
          previewOnly={previewOnly}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            {previewOnly ? (
              // ── 预览已导出文件：直接用原生 img/video ──
              <div className="preview-stage">
                {isVideo && (
                  <video
                    key={currentFilePath}
                    src={displaySource}
                    controls
                    autoPlay
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                )}
                {isImage && (
                  <img
                    key={currentFilePath}
                    src={displaySource}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                )}
              </div>
            ) : (
              <PreviewStage
                url={displaySource}
                extraLayers={watermarkLayers}
                pending={mediaSize == null}
                exportOptions={{ enable: true }}
              />
            )}

            <PreviewThumbnailStrip
              filePathList={filePathList ?? [currentFilePath]}
              initialFilePath={currentFilePath}
              onChange={(fp) => setCurrentFilePath(fp)}
            />
          </div>

          {inspectorOpen && (
            <MediaInspector
              filePath={currentFilePath}
              onToggleCollapse={() => setInspectorOpen(false)}
              header={!previewOnly ? (
                <WatermarkSettings
                  onChange={handleWatermarkChange}
                  filePath={currentFilePath}
                  mediaWidth={mediaSize?.w}
                  mediaHeight={mediaSize?.h}
                />
              ) : undefined}
            />
          )}
        </div>
      </section>
    </Dialog>
  )
}
