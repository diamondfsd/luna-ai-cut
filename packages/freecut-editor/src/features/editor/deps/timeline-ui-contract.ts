/**
 * Adapter exports for timeline UI dependencies.
 * Editor modules should import timeline feature UI components from here.
 */

export { useBentoLayoutDialogStore } from '@freecut/features/timeline/components/bento-layout-dialog-store'
export { useFillerRemovalDialogStore } from '@freecut/features/timeline/stores/filler-removal-dialog-store'
export { useReverseConformDialogStore } from '@freecut/features/timeline/stores/reverse-conform-dialog-store'
export { useSilenceRemovalDialogStore } from '@freecut/features/timeline/stores/silence-removal-dialog-store'

export const importTimeline = () => import('@freecut/features/timeline/components/timeline')
export const importBentoLayoutDialog = () => import('@freecut/features/timeline/components/bento-layout-dialog')
export const importFillerRemovalDialog = () => import('@freecut/features/timeline/components/filler-removal-dialog')
export const importReverseConformDialog = () => import('@freecut/features/timeline/components/reverse-conform-dialog')
export const importSilenceRemovalDialog = () => import('@freecut/features/timeline/components/silence-removal-dialog')
