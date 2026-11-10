import { useCallback } from 'react'
import { useApp } from '../context/AppContext'
import type { VideoExportSettings, WorkspaceExportPreset } from '../shared/types'
import { toast } from '../ui'

export function useWorkspaceExportPresets() {
  const { settings, setSettings } = useApp()
  const presets = settings?.workspaceExportPresets ?? []

  const save = useCallback(async (name: string, exportConfig: VideoExportSettings): Promise<WorkspaceExportPreset> => {
    const preset: WorkspaceExportPreset = {
      id: `workspace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      exportConfig: structuredClone(exportConfig),
    }
    const current = await window.luna.getSettings()
    const updated = await window.luna.saveSettings({
      workspaceExportPresets: [...(current.workspaceExportPresets ?? []), preset].slice(-100),
    })
    setSettings(updated)
    toast.success('方案已保存')
    return preset
  }, [setSettings])

  const remove = useCallback(async (presetId: string): Promise<void> => {
    const current = await window.luna.getSettings()
    const updated = await window.luna.saveSettings({
      workspaceExportPresets: (current.workspaceExportPresets ?? []).filter((preset) => preset.id !== presetId),
    })
    setSettings(updated)
  }, [setSettings])

  return { presets, save, remove }
}
