import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  DirectorLabMediaMetadata,
  DirectorLanPlanSummary,
  DirectorLanShotAttribute,
} from '../../../src/shared/types'
import { DIRECTOR_PLAN_ATTRIBUTES, directorPlanContentSignature } from '../../../src/lib/directorPlanSync.ts'

let planWriteTask: Promise<unknown> = Promise.resolve()

export function serializePlanWrite<Result>(action: () => Promise<Result>): Promise<Result> {
  const task = planWriteTask.catch(() => undefined).then(action)
  planWriteTask = task
  return task
}

export function safePathPart(value: string, fallback: string): string {
  const normalized = path.basename(value.trim())
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : fallback
}

export function mediaFolder(shotOrder: number, shotName: string): string {
  return path.join(
    'media',
    `${String(shotOrder).padStart(2, '0')}_${safePathPart(shotName, 'shot')}`,
  )
}

export function mediaFileName(takeIndex: number, fileName: string): string {
  return `${String(takeIndex).padStart(2, '0')}_${safePathPart(fileName, 'media')}`
}

export function planDirectory(planTitle: string): string {
  return safePathPart(planTitle, '导演计划')
}

export function legacyShotAttribute(
  shot: { attributes?: DirectorLanShotAttribute[] },
  names: string[],
): string {
  const attribute = shot.attributes?.find((item) => names.includes(item.name.trim()))
  return attribute?.description?.trim() ?? ''
}

function readmeForPlan(plan: DirectorLanPlanSummary): string {
  const lines = [
    `# ${plan.title}`,
    '',
    '拍摄计划素材包',
    '视频选取范围记录在 manifest.json 中，单位为毫秒；原始视频不会被裁剪或转码。',
    '',
    '## 镜头清单',
  ]
  plan.shots.forEach((shot, shotIndex) => {
    lines.push('', `### ${shotIndex + 1}. ${shot.name}`, '')
    for (const definition of plan.attributes ?? []) {
      const description = shot.attributes?.find((attribute) =>
        attribute.id === definition.id || attribute.name === definition.name
      )?.description.trim() ?? ''
      lines.push(`- ${definition.name}：${description || '—'}`)
    }
    if (shot.remark.trim()) lines.push(`- 备注：${shot.remark.trim()}`)
    lines.push(`- 建议时长：${Math.round(shot.duration_ms / 1000)} 秒`)
    if (shot.takes.length === 0) lines.push('- 素材：暂无')
    shot.takes.forEach((take, takeIndex) => {
      const folder = mediaFolder(shot.order, shot.name)
      const relativePath = path.posix.join(folder.replace(/\\/g, '/'), mediaFileName(takeIndex + 1, take.file_name))
      lines.push(`- 素材 ${takeIndex + 1}（${take.kind === 'video' ? '视频' : '照片'}）：${take.available ? relativePath : '文件缺失'}`)
      if (take.selected_range) {
        lines.push(`- 选取范围：${take.selected_range.start_ms} - ${take.selected_range.end_ms} ms`)
      }
    })
  })
  return `${lines.join('\n')}\n`
}

export function manifestForPlan(
  plan: DirectorLanPlanSummary,
  metadata: Record<string, DirectorLabMediaMetadata> = {},
): string {
  return JSON.stringify({
    format: 'luna-director-plan-v1',
    plan_id: plan.id,
    title: plan.title,
    main_content: plan.main_content ?? '',
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    revision: plan.revision ?? 0,
    synced_revision: plan.synced_revision ?? plan.revision ?? 0,
    synced_signature: plan.synced_signature ?? directorPlanContentSignature(plan),
    pending_create: plan.pending_create ?? false,
    pending_shot_ids: plan.pending_shot_ids ?? [],
    pending_take_ids: plan.pending_take_ids ?? [],
    exported_at: new Date().toISOString(),
    attributes: plan.attributes ?? DIRECTOR_PLAN_ATTRIBUTES,
    shots: plan.shots.map((shot, shotIndex) => ({
      id: shot.id,
      order: shotIndex + 1,
      name: shot.name,
      attributes: shot.attributes ?? [],
      remark: shot.remark ?? '',
      visual_description: legacyShotAttribute(shot, ['画面说明', '画面', '目标', '拍摄目标'])
        || shot.visual_description
        || '',
      objective: legacyShotAttribute(shot, ['画面说明', '画面', '目标', '拍摄目标'])
        || shot.visual_description
        || '',
      duration_ms: shot.duration_ms,
      movement_description: legacyShotAttribute(shot, ['运镜说明', '运镜', '相机运动'])
        || shot.movement_description
        || '',
      media: shot.takes.map((take, takeIndex) => ({
        id: take.id,
        file_name: take.file_name,
        type: take.kind,
        created_at: take.created_at,
        captured_at: metadata[take.id]?.capturedAt ?? take.captured_at ?? null,
        duration_ms: metadata[take.id]?.durationMs ?? take.duration_ms ?? null,
        width: metadata[take.id]?.width ?? take.width ?? null,
        height: metadata[take.id]?.height ?? take.height ?? null,
        codec: metadata[take.id]?.codec ?? take.codec ?? null,
        path: take.available
          ? path.posix.join(mediaFolder(shot.order, shot.name).replace(/\\/g, '/'), mediaFileName(takeIndex + 1, take.file_name))
          : null,
        available: take.available,
        selected_range: take.selected_range,
      })),
    })),
  }, null, 2)
}

export function planWithDownloadedTake(
  plan: DirectorLanPlanSummary,
  takeId: string,
): DirectorLanPlanSummary {
  let found = false
  const shots = plan.shots.map((shot) => ({
    ...shot,
    takes: shot.takes.map((take) => {
      if (take.id !== takeId) return take
      found = true
      return { ...take, available: true }
    }),
  }))
  if (!found) throw new Error('素材不属于当前计划')
  return { ...plan, shots }
}

interface ExistingManifestMedia {
  id?: unknown
  path?: unknown
  available?: unknown
  duration_ms?: unknown
  captured_at?: unknown
  width?: unknown
  height?: unknown
  codec?: unknown
}

interface ExistingManifest {
  format?: unknown
  plan_id?: unknown
  title?: unknown
  updated_at?: unknown
  revision?: unknown
  pending_shot_ids?: unknown
  pending_take_ids?: unknown
  shots?: Array<{ media?: ExistingManifestMedia[] }>
}

async function localFileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

async function findPlanDirectoryById(rootDirectory: string, planId: string): Promise<string | null> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(rootDirectory, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = path.join(rootDirectory, entry.name)
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
      ) as ExistingManifest
      if (manifest.plan_id === planId) return directory
    } catch {
      // Ignore directories that do not contain a readable director plan.
    }
  }
  return null
}

export async function reconcileLocalDirectorPlan(
  rootDirectory: string,
  plan: DirectorLanPlanSummary,
  metadata: Record<string, DirectorLabMediaMetadata> = {},
  resolveConflict = false,
): Promise<boolean> {
  return serializePlanWrite(() => reconcileLocalDirectorPlanUnlocked(rootDirectory, plan, metadata, resolveConflict))
}

async function reconcileLocalDirectorPlanUnlocked(
  rootDirectory: string,
  plan: DirectorLanPlanSummary,
  metadata: Record<string, DirectorLabMediaMetadata>,
  resolveConflict: boolean,
): Promise<boolean> {
  let directory = path.join(rootDirectory, planDirectory(plan.title))
  const existingDirectory = await findPlanDirectoryById(rootDirectory, plan.id)
  if (existingDirectory && path.resolve(existingDirectory) !== path.resolve(directory)) {
    try {
      await fs.rename(existingDirectory, directory)
    } catch {
      directory = existingDirectory
    }
  }
  const manifestPath = path.join(directory, 'manifest.json')
  let existing: ExistingManifest | null = null
  try {
    existing = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ExistingManifest
  } catch {
    // A plan downloaded one take at a time may not have a manifest yet.
  }
  if (typeof existing?.plan_id === 'string' && existing.plan_id !== plan.id) return false
  const pendingShotIds = Array.isArray(existing?.pending_shot_ids)
    ? existing!.pending_shot_ids.filter((shotId): shotId is string => typeof shotId === 'string')
    : []
  if (!resolveConflict && pendingShotIds.some((shotId) => !plan.shots.some((shot) => shot.id === shotId))) return false
  if (!resolveConflict && Array.isArray(existing?.pending_take_ids) && existing!.pending_take_ids.length) return false

  const existingMedia = new Map<string, ExistingManifestMedia>()
  for (const shot of existing?.shots ?? []) {
    for (const item of shot.media ?? []) {
      if (typeof item.id === 'string') existingMedia.set(item.id, item)
    }
  }

  const recoveredMetadata: Record<string, DirectorLabMediaMetadata> = {}
  for (const [takeId, item] of existingMedia) {
    recoveredMetadata[takeId] = {
      takeId,
      durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : null,
      capturedAt: typeof item.captured_at === 'string' ? item.captured_at : null,
      width: typeof item.width === 'number' ? item.width : null,
      height: typeof item.height === 'number' ? item.height : null,
      codec: typeof item.codec === 'string' ? item.codec : null,
      error: null,
    }
  }

  const remoteRevision = plan.revision ?? 0
  const localRevision = typeof existing?.revision === 'number' && Number.isSafeInteger(existing.revision)
    ? existing.revision
    : 0
  const remoteUpdatedAt = Date.parse(plan.updated_at)
  const localUpdatedAt = typeof existing?.updated_at === 'string'
    ? Date.parse(existing.updated_at)
    : Number.NaN
  const remoteIsNewer = remoteRevision > localRevision
    || (
      remoteRevision === localRevision
      && Number.isFinite(remoteUpdatedAt)
      && Number.isFinite(localUpdatedAt)
      && remoteUpdatedAt > localUpdatedAt
    )
  let manifestNeedsUpdate = existing?.format !== 'luna-director-plan-v1'
    || existing.plan_id !== plan.id
  const shots = await Promise.all(plan.shots.map(async (shot) => ({
    ...shot,
    takes: await Promise.all(shot.takes.map(async (take, takeIndex) => {
      const relativePath = path.posix.join(
        mediaFolder(shot.order, shot.name).replace(/\\/g, '/'),
        mediaFileName(takeIndex + 1, take.file_name),
      )
      const absolutePath = path.resolve(directory, relativePath.replace(/[\\/]+/g, path.sep))
      let available = await localFileExists(absolutePath)
      const previous = existingMedia.get(take.id)
      if (!available && typeof previous?.path === 'string') {
        const previousPath = path.resolve(directory, previous.path.replace(/[\\/]+/g, path.sep))
        const realDirectory = await fs.realpath(directory)
        const realPreviousPath = await fs.realpath(previousPath).catch(() => null)
        const relativePreviousPath = realPreviousPath ? path.relative(realDirectory, realPreviousPath) : null
        if (relativePreviousPath && !path.isAbsolute(relativePreviousPath)
          && relativePreviousPath !== '..' && !relativePreviousPath.startsWith(`..${path.sep}`)
          && await localFileExists(realPreviousPath!)) {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true })
          try {
            await fs.link(realPreviousPath!, absolutePath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
              await fs.copyFile(realPreviousPath!, absolutePath, constants.COPYFILE_EXCL)
            }
          }
          available = await localFileExists(absolutePath)
        }
      }
      if (available) {
        if (!previous || previous.available !== true || previous.path !== relativePath) {
          manifestNeedsUpdate = true
        }
      }
      return { ...take, available }
    })),
  })))

  if (!manifestNeedsUpdate && !remoteIsNewer && !resolveConflict && !pendingShotIds.length) return false
  if (resolveConflict && existing) {
    await fs.copyFile(manifestPath, path.join(directory, `manifest.conflict-${randomUUID()}.json`))
  }
  await writeDirectorPlanFilesUnlocked(directory, { ...plan, shots, pending_create: false,
    pending_shot_ids: [], pending_take_ids: [], synced_revision: plan.revision ?? 0,
    synced_signature: directorPlanContentSignature(plan) }, { ...recoveredMetadata, ...metadata })
  return true
}

export async function writeDirectorPlanFiles(
  directory: string,
  plan: DirectorLanPlanSummary,
  metadata: Record<string, DirectorLabMediaMetadata> = {},
): Promise<void> {
  return serializePlanWrite(() => writeDirectorPlanFilesUnlocked(directory, plan, metadata))
}

export async function writeDirectorPlanFilesUnlocked(
  directory: string,
  plan: DirectorLanPlanSummary,
  metadata: Record<string, DirectorLabMediaMetadata> = {},
): Promise<void> {
    await fs.mkdir(directory, { recursive: true })
    for (const shot of plan.shots) for (const [index, take] of shot.takes.entries()) {
      if (!take.available || !take.stream_url?.startsWith('file:')) continue
      const source = fileURLToPath(take.stream_url)
      const target = path.join(directory, mediaFolder(shot.order, shot.name), mediaFileName(index + 1, take.file_name))
      if (path.resolve(source) === path.resolve(target)) continue
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (!await localFileExists(target)) await fs.copyFile(source, target, constants.COPYFILE_EXCL)
    }
    const manifestPath = path.join(directory, 'manifest.json')
    const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(path.join(directory, 'README.md'), readmeForPlan(plan), 'utf8')
      await fs.writeFile(temporaryPath, manifestForPlan(plan, metadata), 'utf8')
      await fs.rename(temporaryPath, manifestPath)
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    }
}
