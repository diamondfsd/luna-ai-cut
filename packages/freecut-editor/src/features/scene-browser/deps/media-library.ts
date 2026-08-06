/**
 * Cross-feature adapter — scene-browser accesses media-library state and
 * the shared source player through this barrel so the import graph stays
 * one-directional (feature-boundary rule in CLAUDE.md).
 */

export * from './media-library-contract'
export { useSourcePlayerStore } from '@freecut/shared/state/source-player'
export { useEditorStore } from '@freecut/shared/state/editor'
export type { MediaMetadata } from '@freecut/types/storage'
