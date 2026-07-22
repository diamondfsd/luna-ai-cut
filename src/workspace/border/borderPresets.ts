import type { FramePreset, FramePresetDefaultSettings } from '../../shared/types'

type PresetModuleValue = FramePreset | PresetModuleValue[] | { default?: PresetModuleValue }

const presetModules = import.meta.glob<PresetModuleValue>('./presets/*.json', {
  eager: true,
  import: 'default',
})

function normalizePresets(value: PresetModuleValue | undefined): FramePreset[] {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(normalizePresets)
  if ('default' in value && value.default) return normalizePresets(value.default)
  const candidate = value as Partial<FramePreset>
  if (typeof candidate.id === 'string' && typeof candidate.name === 'string' && Array.isArray(candidate.layers)) {
    return [candidate as FramePreset]
  }
  console.warn('[FramePreset] 已忽略格式不正确的预设', value)
  return []
}

/** 支持单对象、数组及嵌套数组。文件按名称排序，数组保持文件内顺序。 */
export const FRAME_PRESETS = Object.entries(presetModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, preset]) => normalizePresets(preset))

export function findFramePreset(presetId: string | null | undefined): FramePreset | undefined {
  return FRAME_PRESETS.find((preset) => preset.id === presetId)
}

export function framePresetDefaultSettings(presetId: string | null | undefined): FramePresetDefaultSettings {
  const preset = findFramePreset(presetId)
  if (!preset) return {}
  return {
    ...(preset.defaultTitle ? { title: preset.defaultTitle } : {}),
    ...preset.defaultSettings,
  }
}
