import fs from 'node:fs/promises'

const VIDEO_TRAILER_SCAN_BYTES = 4 * 1024 * 1024
const INSTA360_SIGNATURE = Buffer.from('Insta360', 'ascii')
const I_LOG_SIGNATURE = Buffer.from('I_Log', 'ascii')

export async function detectInsta360ILog(sourcePath: string): Promise<boolean> {
  let handle: fs.FileHandle | null = null
  try {
    const stat = await fs.stat(sourcePath)
    const scanSize = Math.min(stat.size, VIDEO_TRAILER_SCAN_BYTES)
    if (scanSize <= 0) return false

    handle = await fs.open(sourcePath, 'r')
    const buffer = Buffer.alloc(scanSize)
    const { bytesRead } = await handle.read(buffer, 0, scanSize, stat.size - scanSize)
    const trailer = buffer.subarray(0, bytesRead)
    return trailer.includes(INSTA360_SIGNATURE) && trailer.includes(I_LOG_SIGNATURE)
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}
