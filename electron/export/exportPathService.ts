import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

import { allocateExportFileName } from '../../src/shared/exportFileName'

export async function availableExportPath(desiredPath: string): Promise<string> {
  const directory = path.dirname(desiredPath)
  await mkdir(directory, { recursive: true })
  const existingNames = await readdir(directory)
  const fileName = allocateExportFileName(path.basename(desiredPath), existingNames)
  return path.join(directory, fileName)
}
