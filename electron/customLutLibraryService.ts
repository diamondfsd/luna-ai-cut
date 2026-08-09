import * as path from 'node:path'

import type { AppSettings, CustomLutFile } from '../src/shared/types'
import { deleteCustomLutInDirectory, listCustomLutsInDirectory } from './customLutLibrary'
import { getSettings } from './settingsService'

function lutRoot(settings: AppSettings): string {
  return path.resolve(settings.lutDir || path.join(settings.baseDir, 'luts'))
}

export async function listCustomLuts(): Promise<CustomLutFile[]> {
  return listCustomLutsInDirectory(lutRoot(await getSettings()))
}

export async function deleteCustomLut(filePath: string): Promise<void> {
  await deleteCustomLutInDirectory(lutRoot(await getSettings()), filePath)
}
