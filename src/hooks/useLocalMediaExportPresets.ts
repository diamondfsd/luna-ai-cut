import { useCallback, useEffect, useState } from 'react'
import type { LocalMediaExportPreset, VideoExportSettings, WatermarkSettings } from '../shared/types'

export function useLocalMediaExportPresets() {
  const [presets, setPresets] = useState<LocalMediaExportPreset[]>([])

  useEffect(() => {
    let cancelled = false
    void window.luna.getSettings().then((settings) => {
      if (!cancelled) setPresets(settings.localMediaExportPresets ?? [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const save = useCallback(async (
    name: string,
    exportConfig: VideoExportSettings,
    watermarkSettings: WatermarkSettings | null,
    appleLivePhoto: boolean,
  ): Promise<LocalMediaExportPreset> => {
    const settings = await window.luna.getSettings()
    const preset: LocalMediaExportPreset = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      exportConfig: structuredClone(exportConfig),
      watermarkSettings: watermarkSettings ? structuredClone(watermarkSettings) : null,
      appleLivePhoto,
    }
    const updated = await window.luna.saveSettings({
      localMediaExportPresets: [...(settings.localMediaExportPresets ?? []), preset].slice(-100),
    })
    setPresets(updated.localMediaExportPresets ?? [])
    return preset
  }, [])

  const remove = useCallback(async (presetId: string): Promise<void> => {
    const settings = await window.luna.getSettings()
    const updated = await window.luna.saveSettings({
      localMediaExportPresets: (settings.localMediaExportPresets ?? []).filter((preset) => preset.id !== presetId),
    })
    setPresets(updated.localMediaExportPresets ?? [])
  }, [])

  return { presets, save, remove }
}
