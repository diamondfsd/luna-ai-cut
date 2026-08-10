/**
 * Adapter exports for settings dependencies.
 * Editor modules should import settings stores/services from here.
 */

export {
  useSettingsStore,
  CAPTIONING_INTERVAL_BOUNDS,
  DEFAULT_CAPTIONING_INTERVAL_SECONDS,
  resolveCaptioningIntervalSec,
} from '@freecut/features/settings/stores/settings-store'
export type {
  CaptioningIntervalUnit,
  VisualAnalysisIntensity,
} from '@freecut/features/settings/stores/settings-store'
export { LocalInferenceUnloadControl } from '@freecut/features/settings/components/local-inference-unload-control'
export { LocalModelCacheControl } from '@freecut/features/settings/components/local-model-cache-control'
export { useResolvedHotkeys } from '@freecut/features/settings/hooks/use-resolved-hotkeys'
export { HotkeyEditor } from '@freecut/features/settings/components/hotkey-editor'
