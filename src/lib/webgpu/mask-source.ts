import type { CompositionLayer } from '../../shared/types'
import type { WebGpuMaskSource } from './mask'

/** Loads a project-owned grayscale mask through the restricted workspace API. */
export async function loadWebGpuMask(layer: CompositionLayer, path: string): Promise<WebGpuMaskSource> {
  if (!layer.maskProjectId) throw new Error('蒙版所属项目无效')
  const mask = await window.luna.workspace.loadColorMask(layer.maskProjectId, path)
  return {
    width: mask.width,
    height: mask.height,
    bytes: new Uint8Array(mask.bytes),
  }
}
