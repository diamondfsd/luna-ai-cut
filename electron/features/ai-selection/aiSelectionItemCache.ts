import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { AiSelectionItem, AiSelectionPreset } from '../../../src/shared/types'

function itemCachePath(cacheRoot: string, analysisVersion: string, id: string, preset: AiSelectionPreset): string {
  if (!/^media_[a-f0-9]+$/.test(id)) throw new Error('素材缓存标识无效')
  return path.join(cacheRoot, 'items', id, `${analysisVersion}-${preset}.json`)
}

export async function readAiSelectionItemCache(
  cacheRoot: string,
  analysisVersion: string,
  id: string,
  preset: AiSelectionPreset,
): Promise<AiSelectionItem | null> {
  try {
    return JSON.parse(await fs.readFile(itemCachePath(cacheRoot, analysisVersion, id, preset), 'utf8')) as AiSelectionItem
  } catch {
    return null
  }
}

export async function writeAiSelectionItemCache(
  cacheRoot: string,
  analysisVersion: string,
  item: AiSelectionItem,
  preset: AiSelectionPreset,
): Promise<void> {
  if (item.error) return
  const destination = itemCachePath(cacheRoot, analysisVersion, item.id, preset)
  const cachedItem = structuredClone(item)
  cachedItem.state = 'undecided'
  cachedItem.decisionSource = 'ai'
  cachedItem.videoSegments = cachedItem.videoSegments.map((segment) => segment.decisionSource === 'user'
    ? { ...segment, state: segment.status === 'usable' ? 'recommended' : 'undecided', decisionSource: 'ai' }
    : segment)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(cachedItem)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rm(destination, { force: true })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}
