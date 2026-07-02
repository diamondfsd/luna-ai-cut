/** 读取文件的 EXIF 相机型号 */
export async function readExifModel(localPath?: string): Promise<string | null> {
  if (!localPath) return null
  try {
    const exifr = await import('exifr')
    const parsed = await exifr.parse(localPath, { translateValues: false, pick: ['Model', 'Make'] }) as Record<string, unknown> | undefined
    const model = typeof parsed?.Model === 'string' ? parsed.Model : ''
    const make = typeof parsed?.Make === 'string' ? parsed.Make : ''
    return [make, model].filter(Boolean).join(' ') || null
  } catch {
    return null
  }
}
