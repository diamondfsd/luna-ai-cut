import { stat } from 'node:fs/promises'
import path from 'node:path'

export interface CachedModelFile {
  fileName: string
  sizeBytes: number
}

export async function hasCachedModelFiles(modelDir: string, files: CachedModelFile[]): Promise<boolean> {
  if (files.length === 0) return false
  const sizes = await Promise.all(files.map(async (file) => {
    const info = await stat(path.join(modelDir, file.fileName)).catch(() => null)
    return info?.isFile() === true ? info.size : null
  }))
  return sizes.every((size, index) => size === files[index].sizeBytes)
}
