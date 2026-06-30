import sharp from 'sharp'

const WORKSPACE_PREVIEW_MIN_SHORT_EDGE = 2160
const WORKSPACE_PREVIEW_MAX_LONG_EDGE = 4096

interface WorkspacePreviewResult {
  buffer: ArrayBuffer
  mimeType: string
}

function workspacePreviewResize(width?: number, height?: number): { width?: number; height?: number } {
  if (!width || !height) return { width: WORKSPACE_PREVIEW_MAX_LONG_EDGE, height: WORKSPACE_PREVIEW_MAX_LONG_EDGE }
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
  const metadata = await sharp(filePath).rotate().metadata()
  const size = workspacePreviewResize(metadata.width, metadata.height)
  const buffer = await sharp(filePath)
    .rotate()
    .resize(size.width, size.height, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return {
    buffer: arrayBuffer,
    mimeType: 'image/png',
  }
}
