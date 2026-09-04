import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { AppSettings, WorkspaceReferenceMatchLutRequest, WorkspaceReferenceMatchLutResult } from '../../../src/shared/types'
import { safeName } from '../../media/filePathUtils.ts'

const CATEGORY = 'AI追色'
const LUT_SIZE = 33
const MAX_CUBE_BYTES = 8 * 1024 * 1024

function lutRoot(settings: AppSettings): string {
  return path.resolve(settings.lutDir || path.join(settings.baseDir, 'luts'))
}

function validateCube(cube: string): void {
  if (typeof cube !== 'string' || Buffer.byteLength(cube, 'utf8') <= 0 || Buffer.byteLength(cube, 'utf8') > MAX_CUBE_BYTES) {
    throw new Error('追色结果无效或过大')
  }
  let size = 0
  let rows = 0
  for (const rawLine of cube.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('DOMAIN_')) continue
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number(line.slice('LUT_3D_SIZE'.length).trim())
      continue
    }
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    if (parts.slice(0, 3).every((part) => Number.isFinite(Number(part)))) rows += 1
  }
  if (size !== LUT_SIZE || rows !== LUT_SIZE ** 3) throw new Error('追色结果尺寸不正确')
}

function cleanName(value: string): string {
  const normalized = safeName(value.trim()).replace(/\s+/g, ' ').slice(0, 80).trim()
  return normalized || '参考图追色'
}

export async function saveReferenceMatchLut(
  settings: AppSettings,
  request: WorkspaceReferenceMatchLutRequest,
): Promise<WorkspaceReferenceMatchLutResult> {
  validateCube(request.cube)
  if (!request.referenceAssetId || !request.targetAssetId) throw new Error('追色素材信息不完整')

  const displayName = cleanName(request.name)
  const fileBaseName = cleanName(`${displayName}_${Date.now()}`)
  const directory = path.join(lutRoot(settings), CATEGORY)
  const destination = path.join(directory, `${fileBaseName}.cube`)
  const metadata = {
    name: displayName,
    description: request.description?.trim() || `根据「${request.referenceName}」为「${request.targetName}」生成的参考图追色`,
    source: 'Luna AI Cut',
    kind: 'reference-match',
    method: request.method,
    version: 1,
    generatedAt: new Date().toISOString(),
    referenceAssetId: request.referenceAssetId,
    targetAssetId: request.targetAssetId,
    referenceName: request.referenceName,
    targetName: request.targetName,
  }
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(directory, { recursive: true })
  try {
    await fs.writeFile(temporary, request.cube, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, destination)
    await fs.writeFile(`${destination}.meta.json`, JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 })
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
  return { path: destination, name: displayName, category: CATEGORY }
}
