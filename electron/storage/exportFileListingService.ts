import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { LunaFile } from '../../src/shared/types'

/** List exported media files for the local export history. */
export async function listExportFiles(exportDirs: string | string[]): Promise<LunaFile[]> {
  const files: LunaFile[] = []
  for (const exportDir of [...new Set((Array.isArray(exportDirs) ? exportDirs : [exportDirs]).filter(Boolean))]) {
    try {
      const entries = await readdir(exportDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !entry.isFile()) continue
        const fullPath = join(exportDir, entry.name)
        const fileStat = await stat(fullPath)
        files.push({
          id: fullPath,
          name: entry.name,
          downloadName: entry.name,
          url: '',
          sourceUrl: '',
          kind: 'image',
          extension: entry.name.split('.').pop() || '',
          bytes: fileStat.size,
          width: 0,
          height: 0,
          downloadFilePath: fullPath,
          localPath: fullPath,
        } as unknown as LunaFile)
      }
    } catch {
      // Ignore export folders that are no longer available.
    }
  }
  return files
}
