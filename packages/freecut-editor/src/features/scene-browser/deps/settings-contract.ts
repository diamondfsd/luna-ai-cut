/**
 * Adapter — scene-browser reads `captionSearchMode` from the app settings
 * store through this contract so the boundary checker stays happy.
 */

export { useSettingsStore } from '@freecut/features/settings/stores/settings-store'
export type { CaptionSearchMode } from '@freecut/features/settings/stores/settings-store'
