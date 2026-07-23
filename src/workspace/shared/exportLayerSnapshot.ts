import type { PreviewLayer } from '../../shared/types'

/** Freeze render inputs at queue time so later project edits cannot change an active export. */
export function snapshotPreviewLayers(layers: PreviewLayer[] | undefined): PreviewLayer[] | undefined {
  return layers === undefined ? undefined : structuredClone(layers)
}
