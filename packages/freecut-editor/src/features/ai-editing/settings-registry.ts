import {
  CAPTIONING_INTERVAL_BOUNDS,
  useSettingsStore,
} from '@freecut/features/editor/deps/settings'

type SettingValue = boolean | number | string | null | Record<string, string>

export type AiEditableSettingKey =
  | 'snapEnabled'
  | 'timelineSectionDividerPosition'
  | 'canvasSnapEnabled'
  | 'showTimelineHoverPreview'
  | 'showWaveforms'
  | 'showFilmstrips'
  | 'enableFilmstripExtraction'
  | 'editorDensity'
  | 'maxUndoHistory'
  | 'autoSaveInterval'
  | 'defaultWhisperModel'
  | 'defaultWhisperQuantization'
  | 'defaultWhisperLanguage'
  | 'captioningIntervalUnit'
  | 'captioningIntervalValue'
  | 'captionSearchMode'
  | 'defaultCaptionStylePresetId'
  | 'hotkeyOverrides'

export interface AiSettingDefinition {
  key: AiEditableSettingKey
  label: string
  description: string
  valueType: 'boolean' | 'number' | 'string' | 'object'
  risk: 'edit' | 'settings'
  min?: number
  max?: number
  values?: readonly string[]
}

export interface AiSettingChange {
  key: AiEditableSettingKey
  value: SettingValue
}

const SETTINGS: readonly AiSettingDefinition[] = [
  { key: 'snapEnabled', label: '时间轴吸附', description: '移动素材时自动对齐边界。', valueType: 'boolean', risk: 'settings' },
  { key: 'timelineSectionDividerPosition', label: '轨道分隔位置', description: '调整视频与音频区域的分隔位置。', valueType: 'number', risk: 'settings', min: 0 },
  { key: 'canvasSnapEnabled', label: '画面吸附', description: '移动画面元素时自动对齐。', valueType: 'boolean', risk: 'settings' },
  { key: 'showTimelineHoverPreview', label: '悬停预览', description: '在时间轴悬停时显示画面预览。', valueType: 'boolean', risk: 'settings' },
  { key: 'showWaveforms', label: '显示波形', description: '在音频素材上显示声音波形。', valueType: 'boolean', risk: 'settings' },
  { key: 'showFilmstrips', label: '显示缩略图', description: '在视频素材上显示画面缩略图。', valueType: 'boolean', risk: 'settings' },
  { key: 'enableFilmstripExtraction', label: '生成缩略图', description: '允许为视频生成时间轴缩略图。', valueType: 'boolean', risk: 'settings' },
  { key: 'editorDensity', label: '编辑器密度', description: '调整编辑器界面的紧凑程度。', valueType: 'string', risk: 'settings', values: ['compact'] },
  { key: 'maxUndoHistory', label: '撤销步数', description: '保留的编辑撤销记录数量。', valueType: 'number', risk: 'settings', min: 1, max: 500 },
  { key: 'autoSaveInterval', label: '自动保存间隔', description: '自动保存编辑内容的间隔分钟数。', valueType: 'number', risk: 'settings', min: 0, max: 120 },
  { key: 'defaultWhisperModel', label: '默认字幕模型', description: '新建字幕识别任务使用的模型。', valueType: 'string', risk: 'settings', values: ['parakeet-tdt-v3', 'whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-large'] },
  { key: 'defaultWhisperQuantization', label: '字幕模型精度', description: '字幕识别的速度与精度偏好。', valueType: 'string', risk: 'settings', values: ['hybrid', 'fp32', 'fp16', 'q8', 'q4'] },
  { key: 'defaultWhisperLanguage', label: '默认字幕语言', description: '字幕识别时优先使用的语言。', valueType: 'string', risk: 'settings' },
  { key: 'captioningIntervalUnit', label: '画面分析单位', description: '画面理解任务的采样单位。', valueType: 'string', risk: 'settings', values: ['seconds', 'frames'] },
  { key: 'captioningIntervalValue', label: '画面分析间隔', description: '画面理解任务的采样间隔。', valueType: 'number', risk: 'settings', min: CAPTIONING_INTERVAL_BOUNDS.seconds.min, max: CAPTIONING_INTERVAL_BOUNDS.frames.max },
  { key: 'captionSearchMode', label: '场景搜索方式', description: '按关键词或含义搜索已分析画面。', valueType: 'string', risk: 'settings', values: ['keyword', 'semantic'] },
  { key: 'defaultCaptionStylePresetId', label: '默认字幕样式', description: '新生成字幕使用的样式。', valueType: 'string', risk: 'settings' },
  { key: 'hotkeyOverrides', label: '快捷键', description: '已自定义的快捷键设置。', valueType: 'object', risk: 'settings' },
]

const DEFINITIONS = new Map(SETTINGS.map((setting) => [setting.key, setting]))

export function listAiEditableSettings(): readonly AiSettingDefinition[] {
  return SETTINGS
}

export function getAiEditableSettings(): Record<AiEditableSettingKey, SettingValue> {
  const state = useSettingsStore.getState()
  return Object.fromEntries(SETTINGS.map((setting) => [setting.key, state[setting.key]])) as Record<
    AiEditableSettingKey,
    SettingValue
  >
}

function validObject(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

function validateValue(definition: AiSettingDefinition, value: unknown): value is SettingValue {
  if (definition.key === 'timelineSectionDividerPosition' && value === null) return true
  if (definition.valueType === 'boolean') return typeof value === 'boolean'
  if (definition.valueType === 'object') return validObject(value)
  if (definition.valueType === 'number') {
    return typeof value === 'number'
      && Number.isFinite(value)
      && (definition.min === undefined || value >= definition.min)
      && (definition.max === undefined || value <= definition.max)
  }
  return typeof value === 'string' && (!definition.values || definition.values.includes(value))
}

export function validateAiSettingChanges(value: unknown):
  | { ok: true; changes: AiSettingChange[] }
  | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: '需要至少提供一项设置。' }
  }

  const changes: AiSettingChange[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: '设置格式无效。' }
    const candidate = entry as { key?: unknown; value?: unknown }
    if (typeof candidate.key !== 'string') return { ok: false, error: '设置项缺少名称。' }
    const definition = DEFINITIONS.get(candidate.key as AiEditableSettingKey)
    if (!definition) return { ok: false, error: `不支持调整“${candidate.key}”。` }
    if (!validateValue(definition, candidate.value)) {
      return { ok: false, error: `“${definition.label}”的值不符合要求。` }
    }
    changes.push({ key: definition.key, value: candidate.value })
  }
  return { ok: true, changes }
}

export function applyAiSettingChanges(changes: readonly AiSettingChange[]): void {
  const store = useSettingsStore.getState()
  for (const change of changes) {
    if (change.key === 'hotkeyOverrides') {
      store.replaceHotkeyOverrides(change.value as Record<string, string>)
      continue
    }
    store.setSetting(change.key as never, change.value as never)
  }
}
