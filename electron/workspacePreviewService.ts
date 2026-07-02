import { nativeImage } from 'electron'

const WORKSPACE_PREVIEW_MIN_SHORT_EDGE = 2160
const WORKSPACE_PREVIEW_MAX_LONG_EDGE = 4096

interface WorkspacePreviewResult {
  buffer: ArrayBuffer
  mimeType: string
}

function workspacePreviewResize(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  let scale = Math.min(1, WORKSPACE_PREVIEW_MAX_LONG_EDGE / longEdge)
  if (shortEdge * scale < WORKSPACE_PREVIEW_MIN_SHORT_EDGE) {
    scale = Math.min(1, WORKSPACE_PREVIEW_MIN_SHORT_EDGE / shortEdge)
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export async function loadWorkspacePreview(filePath: string): Promise<WorkspacePreviewResult> {
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) {
    throw new Error(`无法加载图片: ${filePath}`)
  }
  const size = workspacePreviewResize(image.getSize().width, image.getSize().height)
  const resized = image.resize({ width: size.width, height: size.height })
  const buffer = resized.toJPEG(92)
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return {
    buffer: arrayBuffer,
    mimeType: 'image/jpeg',
  }
}
