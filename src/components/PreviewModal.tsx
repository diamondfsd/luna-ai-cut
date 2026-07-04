import { useEffect, useMemo, useState } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { filePathToLunaFile } from './previewModalUtils'
import type { PreviewLayer, PreviewResult, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { Dialog } from '../ui'
import '../styles/modal.css'

interface PreviewModalProps {
  filePath: string
  filePathList?: string[]
  onClose: () => void
}

export function PreviewModal({
  filePath,
  filePathList,
  onClose,
}: PreviewModalProps) {
  // ── 当前预览文件路径 ──
  const [currentFilePath, setCurrentFilePath] = useState(filePath)

  // 外部 filePath 变化时重置
  useEffect(() => {
    setCurrentFilePath(filePath)
  }, [filePath])

  // ── 文件信息 ──
  const file = useMemo(() => filePathToLunaFile(currentFilePath), [currentFilePath])

  const files = useMemo(() => filePathList?.map((p) => filePathToLunaFile(p)) ?? [file], [filePathList, file])

  // ── 预览加载 ──
  const [internalPreview, setInternalPreview] = useState<PreviewResult | null>(null)

  useEffect(() => {
    // 不立即清空，保持旧图可见，等新图加载完成再替换
    window.luna.previewFile(file, files)
      .then(setInternalPreview)
      .catch(() => {})
  }, [file.id])

  // ── 状态 ──
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra',
    position: 'BottomCenter' as any,
  })
  const [watermarkLayers, setWatermarkLayers] = useState<PreviewLayer[]>([])
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null)

  // 获取媒体分辨率用于水印布局匹配
  useEffect(() => {
    if (!currentFilePath) { setMediaSize(null); return }
    window.luna.workspace.getMediaResolution(currentFilePath)
      .then(({ width, height }) => setMediaSize({ w: width, h: height }))
      .catch(() => setMediaSize(null))
  }, [currentFilePath])

  const displaySource = internalPreview?.source ?? null

  // WatermarkSettings onChange 回调
  function handleWatermarkChange(settings: WatermarkSettingsType, layer?: PreviewLayer) {
    setWatermarkSettings(settings)
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
          file={file}
          inspectorOpen={inspectorOpen}
          onSetInspectorOpen={setInspectorOpen}
          onClose={onClose}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            <PreviewStage url={displaySource} extraLayers={watermarkLayers} />

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
              header={
                <WatermarkSettings
                  settings={watermarkSettings}
                  onChange={handleWatermarkChange}
                  filePath={currentFilePath}
                  mediaWidth={mediaSize?.w}
                  mediaHeight={mediaSize?.h}
                />
              }
            />
          )}
        </div>
      </section>
    </Dialog>
  )
}
