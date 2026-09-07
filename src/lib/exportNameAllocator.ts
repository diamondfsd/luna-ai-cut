import { createExportNameAllocator } from '../shared/exportFileName'

export async function createDirectoryExportNameAllocator(
  exportDir: string,
): Promise<(desiredName: string) => string> {
  const files = await window.luna.listExportFiles(exportDir)
  return createExportNameAllocator(files.map((file) => file.name))
}
