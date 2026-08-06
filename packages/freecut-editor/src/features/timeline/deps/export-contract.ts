/**
 * Adapter exports for export dependencies.
 * Timeline modules should import export rendering utilities from here.
 */

export { convertTimelineToComposition } from '@freecut/features/export/utils/timeline-to-composition'
export type { ClientExportSettings, RenderProgress } from '@freecut/features/export/utils/client-renderer'

export const importCanvasRenderOrchestrator = () =>
  import('@freecut/features/export/utils/canvas-render-orchestrator')
