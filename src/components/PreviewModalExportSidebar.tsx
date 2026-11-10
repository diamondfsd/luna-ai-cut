import type { PreviewLayer, WatermarkSettings, VideoExportSettings } from '../shared/types'
import { AppleLivePhotoExportOption } from './AppleLivePhotoExportOption'
import { buildExportLayers } from './previewStageExport'
import { ExportSettingsPanel } from './ExportSettingsPanel'
import { LocalMediaExportPresetControl } from './LocalMediaExportPresetControl'
import { Button } from '../ui'
import './PreviewModalExportSidebar.css'

interface PreviewModalExportSidebarProps {
  hasVideoInBatch: boolean
  exportConfig: VideoExportSettings
  onExportConfigChange: (config: VideoExportSettings) => void
  onWatermarkSettingsChange: (settings: WatermarkSettings | null) => void
  sourcePath: string | null
  onWatermarkLayersChange: (layers: PreviewLayer[]) => void
  dolbyVisionAvailable?: boolean
  dolbyVisionChecking: boolean
  showILogRestore: boolean
  watermarkSettings: WatermarkSettings | null
  appleLivePhoto: boolean
  livePhotoCount: number
  batch: boolean
  onAppleLivePhotoChange: (checked: boolean) => void
  batchEnqueuing: boolean
  fileCount: number
  onExport: () => void
}

export function PreviewModalExportSidebar({
  hasVideoInBatch,
  exportConfig,
  onExportConfigChange,
  onWatermarkSettingsChange,
  sourcePath,
  onWatermarkLayersChange,
  dolbyVisionAvailable,
  dolbyVisionChecking,
  showILogRestore,
  watermarkSettings,
  appleLivePhoto,
  livePhotoCount,
  batch,
  onAppleLivePhotoChange,
  batchEnqueuing,
  fileCount,
  onExport,
}: PreviewModalExportSidebarProps) {
  return (
    <>
      <LocalMediaExportPresetControl
        exportConfig={exportConfig}
        watermarkSettings={watermarkSettings}
        appleLivePhoto={appleLivePhoto}
        onApply={async (preset) => {
          onExportConfigChange(structuredClone(preset.exportConfig))
          onWatermarkSettingsChange(preset.watermarkSettings ? structuredClone(preset.watermarkSettings) : null)
          onAppleLivePhotoChange(preset.appleLivePhoto)
          if (!sourcePath) {
            onWatermarkLayersChange([])
            return
          }
          const resolution = await window.luna.workspace.getMediaResolution(sourcePath).catch(() => null)
          onWatermarkLayersChange(resolution ? buildExportLayers(sourcePath, resolution, preset.watermarkSettings).slice(1) : [])
        }}
      />
      {hasVideoInBatch && (
        <ExportSettingsPanel
          value={exportConfig}
          onChange={onExportConfigChange}
          dolbyVisionAvailable={dolbyVisionAvailable}
          dolbyVisionChecking={dolbyVisionChecking}
          showILogRestore={showILogRestore}
        />
      )}
      <div className="batch-export-actions">
        <AppleLivePhotoExportOption
          checked={appleLivePhoto}
          livePhotoCount={livePhotoCount}
          batch={batch}
          onCheckedChange={onAppleLivePhotoChange}
        />
        <Button variant="primary" disabled={batchEnqueuing} onClick={onExport} type="button" style={{ width: '100%' }}>
          {batchEnqueuing ? '任务创建中...' : batch ? `确认导出 (${fileCount} 个文件)` : '导出'}
        </Button>
      </div>
    </>
  )
}
