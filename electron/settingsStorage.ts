import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const SETTINGS_DIRECTORY = 'LunaAI-Cut'
export const SETTINGS_FILE = 'settings.json'

export interface StoredSettingsResult<T> {
  value: T | null
  fromLegacyPath: boolean
}

export function stableSettingsPath(appDataPath: string): string {
  return path.join(appDataPath, SETTINGS_DIRECTORY, SETTINGS_FILE)
}

export function legacySettingsPath(userDataPath: string): string {
  return path.join(userDataPath, SETTINGS_FILE)
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function readJsonSync<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

export async function readStoredSettings<T>(primaryPath: string, legacyPath: string): Promise<StoredSettingsResult<T>> {
  const primary = await readJson<T>(primaryPath)
  if (primary) return { value: primary, fromLegacyPath: false }
  if (primaryPath === legacyPath) return { value: null, fromLegacyPath: false }
  const legacy = await readJson<T>(legacyPath)
  return { value: legacy, fromLegacyPath: legacy !== null }
}

export function readStoredSettingsSync<T>(primaryPath: string, legacyPath: string): StoredSettingsResult<T> {
  const primary = readJsonSync<T>(primaryPath)
  if (primary) return { value: primary, fromLegacyPath: false }
  if (primaryPath === legacyPath) return { value: null, fromLegacyPath: false }
  const legacy = readJsonSync<T>(legacyPath)
  return { value: legacy, fromLegacyPath: legacy !== null }
}
