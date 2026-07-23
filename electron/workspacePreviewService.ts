import { nativeImage } from 'electron'
import * as fs from 'node:fs/promises'

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

/**
 * 从 Live Photo 文件中提取纯 JPEG 数据（截断尾部视频）。
 * 返回 JPEG buffer，或 null（非 Motion Photo 文件）。
 */
async function extractJpegFromMotionPhoto(filePath: string): Promise<Buffer | null> {
  try {
    const fd = await fs.open(filePath, 'r')
    // 读文件头 64KB 找 ftyp marker
    const head = Buffer.alloc(65536)
    const { bytesRead } = await fd.read(head, 0, 65536, 0)
    await fd.close()
    const buf = head.subarray(0, bytesRead)
    const marker = Buffer.from('ftyp', 'ascii')
    const ftypOffset = buf.indexOf(marker)
    if (ftypOffset < 4) return null
    const mp4Offset = ftypOffset - 4
    // 只读 JPEG 部分到 mp4Offset
    const stat = await fs.stat(filePath)
    const readLen = Math.min(mp4Offset, stat.size)
    const fd2 = await fs.open(filePath, 'r')
    const jpegBuf = Buffer.alloc(readLen)
    await fd2.read(jpegBuf, 0, readLen, 0)
    await fd2.close()
    // 检查是否是完整的 JPEG（以 FF D9 结尾）
    if (jpegBuf[jpegBuf.length - 2] === 0xFF && jpegBuf[jpegBuf.length - 1] === 0xD9) {
      return jpegBuf
    }
    return null
  } catch {
    return null
  }
}

export async function loadWorkspacePreview(filePath: string): Promise<WorkspacePreviewResult> {
  // 对 Motion Photo 文件提取纯 JPEG 后再加载
  const jpegOnly = await extractJpegFromMotionPhoto(filePath)
  const image = jpegOnly
    ? nativeImage.createFromBuffer(jpegOnly)
    : nativeImage.createFromPath(filePath)
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
