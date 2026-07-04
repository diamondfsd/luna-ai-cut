import { useEffect, useMemo, useRef, useState } from 'react'
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
  const thumbStripRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)

  // ── 内部文件索引导航 ──
  const [currentIndex, setCurrentIndex] = useState(() => {
    const idx = filePathList?.indexOf(filePath) ?? -1
    return idx >= 0 ? idx : 0
  })

  const currentFilePath = filePathList?.[currentIndex] ?? filePath

  // 外部 filePath 变化时重置索引
  useEffect(() => {
    const idx = filePathList?.indexOf(filePath) ?? -1
    setCurrentIndex(idx >= 0 ? idx : 0)
  }, [filePath, filePathList])

  // ── 文件信息 ──
  const file = useMemo(() => filePathToLunaFile(currentFilePath), [currentFilePath])

  const files = useMemo(() => filePathList?.map((p) => filePathToLunaFile(p)) ?? [file], [filePathList, file])

  const hasPrevious = currentIndex > 0
  const hasNext = filePathList ? currentIndex < filePathList.length - 1 : false

  function navigateFile(direction: -1 | 1): void {
    const next = currentIndex + direction
    if (next < 0 || next >= (filePathList?.length ?? 1)) return
    setCurrentIndex(next)
  }

  // ── 预览加载 ──
  const [internalPreview, setInternalPreview] = useState<PreviewResult | null>(null)
  const [, setInternalPreviewLoading] = useState(false)

  useEffect(() => {
    setInternalPreview(null)
    setInternalPreviewLoading(true)
    window.luna.previewFile(file, files)
      .then(setInternalPreview)
      .catch(() => {})
      .finally(() => setInternalPreviewLoading(false))
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

  // 键盘导航
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowUp') && hasPrevious) navigateFile(-1)
      if ((event.key === 'ArrowRight' || event.key === 'ArrowDown') && hasNext) navigateFile(1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasPrevious, hasNext, onClose])

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
              activeThumbRef={activeThumbRef}
              currentFileId={file.id}
              files={files}
              stripRef={thumbStripRef}
              onFileChange={(f) => {
                const idx = files.findIndex((x) => x.id === f.id)
                if (idx >= 0) setCurrentIndex(idx)
              }}
            />
          </div>

          {inspectorOpen && <MediaInspector filePath={currentFilePath} onToggleCollapse={() => setInspectorOpen(false)} />}
        </div>
      </section>
    </Dialog>
  )
}
