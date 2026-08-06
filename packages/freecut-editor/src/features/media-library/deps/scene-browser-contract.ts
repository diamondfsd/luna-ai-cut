/**
 * Adapter — media-library mounts the Scene Browser panel and opens it from
 * the info popover through this contract.
 */

export { useSceneBrowserStore } from '@freecut/features/scene-browser/stores/scene-browser-store'

export const importSceneBrowserPanel = () =>
  import('@freecut/features/scene-browser/components/scene-browser-panel')
