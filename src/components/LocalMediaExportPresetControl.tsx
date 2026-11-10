import type { VideoExportSettings, WatermarkSettings } from '../shared/types'
import { toast } from '../ui'
import { ExportPresetControl } from './ExportPresetControl'
import { useLocalMediaExportPresets } from '../hooks/useLocalMediaExportPresets'

interface LocalMediaExportPresetControlProps {
  exportConfig: VideoExportSettings
  watermarkSettings: WatermarkSettings | null
  appleLivePhoto: boolean
  onApply: (preset: { exportConfig: VideoExportSettings; watermarkSettings: WatermarkSettings | null; appleLivePhoto: boolean }) => void
}

export function LocalMediaExportPresetControl({
  exportConfig,
  watermarkSettings,
  appleLivePhoto,
  onApply,
}: LocalMediaExportPresetControlProps) {
  const { presets, save, remove } = useLocalMediaExportPresets()

  return (
    <ExportPresetControl
      presets={presets}
      onApply={onApply}
      onSave={async (name) => {
        const preset = await save(name, exportConfig, watermarkSettings, appleLivePhoto)
        toast.success('方案已保存')
        return preset
      }}
      onDelete={remove}
    />
  )
}
