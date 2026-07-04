import { useEffect, useMemo, useState } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { filePathToLunaFile } from './previewModalUtils'
import type { PreviewResult, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { luna_ultra_layout, STYLE_TO_THEME } from '../shared/watermark/layoutConfig'
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
  const [watermarkSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra',
    position: 'BottomCenter' as any,
  })

  const displaySource = internalPreview?.source ?? null

  // 切换文件时打印水印参数
  useEffect(() => {
    if (!watermarkSettings.enabled) return
    const theme = STYLE_TO_THEME[watermarkSettings.style]
    if (!theme) return
    const key = `${theme}|16:9|${watermarkSettings.position}`
    const ratios = luna_ultra_layout[key]
    console.log(`[PreviewModal] 切换文件: ${file.name}`, {
      style: watermarkSettings.style,
      position: watermarkSettings.position,
      deviceId: file.sourceDeviceId,
      layoutKey: key,
      ratios,
    })
  }, [file.id, watermarkSettings.enabled, watermarkSettings.style, watermarkSettings.position])

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
            <PreviewStage url={displaySource} />

            <PreviewThumbnailStrip
              filePathList={filePathList ?? [currentFilePath]}
              initialFilePath={currentFilePath}
              onChange={(fp) => setCurrentFilePath(fp)}
            />
          </div>

          {inspectorOpen && <MediaInspector filePath={currentFilePath} onToggleCollapse={() => setInspectorOpen(false)} />}
        </div>
      </section>
    </Dialog>
  )
}
