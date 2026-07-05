import { useEffect, useRef, useState } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import type { PreviewStageHandle } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
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

  // ── 状态 ──
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra_cn',
    position: 'BottomCenter' as any,
  })
  const [watermarkLayers, setWatermarkLayers] = useState<PreviewLayer[]>([])
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null)

  // 获取媒体分辨率用于水印布局匹配
  useEffect(() => {
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
  }, [currentFilePath])

  const displaySource = filePathToPreviewUrl(currentFilePath) ?? currentFilePath

  // WatermarkSettings onChange 回调
  function handleWatermarkChange(settings: WatermarkSettingsType, layer?: PreviewLayer) {
    setWatermarkSettings(settings)
    setWatermarkLayers(layer ? [layer] : [])
  }

  // ── 导出 ──
  const stageRef = useRef<PreviewStageHandle>(null)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const result = await stageRef.current?.export()
      if (result) {
        window.luna.log('info', `导出成功: ${result.path}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.luna.log('error', `导出失败: ${msg}`)
    } finally {
      setExporting(false)
    }
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
          onExport={handleExport}
          exporting={exporting}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            <PreviewStage
              ref={stageRef}
              url={displaySource}
              extraLayers={watermarkLayers}
              pending={mediaSize == null}
              exportOptions={{ enable: true }}
            />

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
