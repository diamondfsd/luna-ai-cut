import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DirectorLabDownloadPlanRequest, DirectorLabProbeRequest, DirectorLabMediaMetadata, DirectorLanPlanAttribute } from '../../../src/shared/types/directorLab.ts'
import { validateDirectorTakeMarkers } from '../../../src/lib/directorTakeMarkers.ts'
import { directorPlanContentSignature } from '../../../src/lib/directorPlanSync.ts'
import { legacyShotAttribute } from './directorLabPlanStorage.ts'

interface LocalManifestMedia {
  file_name?: unknown
  id?: unknown
  type?: unknown
  created_at?: unknown
  captured_at?: unknown
  duration_ms?: unknown
  width?: unknown
  height?: unknown
  codec?: unknown
  path?: unknown
  available?: unknown
  selected_range?: unknown
  markers?: unknown
  location?: Record<string, unknown> | null
  source_camera_path?: string | null
}

interface LocalManifestShot {
  id?: unknown
  name?: unknown
  order?: unknown
  attributes?: unknown
  remark?: unknown
  visual_description?: unknown
  movement_description?: unknown
  duration_ms?: unknown
  shot_recipe?: Record<string, unknown> | null
  media?: unknown
}

interface LocalManifest {
  remote_origin?: unknown
  remote_deleted?: unknown
  deleted_local_take_ids?: unknown
  main_content?: unknown
  agent_creation_receipt?: unknown
  agent_write_receipt?: unknown
  pending_create?: unknown
  pending_shot_ids?: unknown
  pending_take_ids?: unknown
  format?: unknown
  plan_id?: unknown
  title?: unknown
  created_at?: unknown
  updated_at?: unknown
  revision?: unknown
  synced_revision?: unknown
  synced_signature?: unknown
  attributes?: unknown
  shots?: unknown
}

async function localPathForManifestMedia(planDirectory: string, mediaPath: string): Promise<string | null> {
  const candidate = path.resolve(planDirectory, mediaPath.replace(/[\\/]+/g, path.sep))
  try {
    const root = await fs.realpath(planDirectory)
    const actual = await fs.realpath(candidate)
    const relative = path.relative(root, actual)
    return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative) ? actual : null
  } catch { return null }
}

function receipt(value: unknown): { keyHash: string; inputHash: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return typeof record.keyHash === 'string' && /^[a-f0-9]{64}$/.test(record.keyHash)
    && typeof record.inputHash === 'string' && /^[a-f0-9]{64}$/.test(record.inputHash)
    ? { keyHash: record.keyHash, inputHash: record.inputHash } : undefined
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function localPlanFromManifest(manifestPath: string, probeMediaOne?: (request: DirectorLabProbeRequest) => Promise<DirectorLabMediaMetadata>): Promise<DirectorLabDownloadPlanRequest['plan'] | null> {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as LocalManifest
    if (raw.remote_deleted === true || raw.format !== 'luna-director-plan-v1'
      || typeof raw.plan_id !== 'string' || !Array.isArray(raw.shots)) {
      return null
    }
    const directory = await fs.realpath(path.dirname(manifestPath))
    const deletedLocalTakeIds = new Set(Array.isArray(raw.deleted_local_take_ids)
      ? raw.deleted_local_take_ids.filter((id): id is string => typeof id === 'string') : [])
    const rawShots = raw.shots as LocalManifestShot[]
    const shots = await Promise.all(rawShots.map(async (shot, shotIndex) => {
      const media = Array.isArray(shot.media) ? shot.media as LocalManifestMedia[] : []
      const takes = await Promise.all(media.map(async (item, takeIndex) => {
        const takeId = typeof item.id === 'string' ? item.id : `local-take-${shotIndex}-${takeIndex}`
        const relativePath = typeof item.path === 'string' ? item.path : null
        const absolutePath = relativePath ? await localPathForManifestMedia(directory, relativePath) : null
        const available = absolutePath ? await fileExists(absolutePath) : false
        if (!available && absolutePath && item.available === true) deletedLocalTakeIds.add(takeId)
        const fileUrl = available && absolutePath ? pathToFileURL(absolutePath).toString() : null
        const fileName = absolutePath ? path.basename(absolutePath) : `${shot.id ?? shotIndex}-${takeIndex}`
        const durationMs = typeof item.duration_ms === 'number' && Number.isFinite(item.duration_ms) && item.duration_ms > 0
          ? item.duration_ms
          : null
        const width = typeof item.width === 'number' && Number.isFinite(item.width) && item.width > 0
          ? item.width
          : null
        const height = typeof item.height === 'number' && Number.isFinite(item.height) && item.height > 0
          ? item.height
          : null
        const capturedAt = typeof item.captured_at === 'string'
          && Number.isFinite(Date.parse(item.captured_at))
          ? item.captured_at
          : null
        const needsProbe = available && item.type === 'video' && fileUrl && (
          durationMs == null || capturedAt == null || width == null || height == null
        )
        const observed = needsProbe && probeMediaOne
          ? await probeMediaOne({ takeId, url: fileUrl })
          : null
        const resolvedDuration = observed?.durationMs ?? durationMs
        const resolvedCapturedAt = observed?.capturedAt ?? capturedAt
        const resolvedWidth = observed?.width ?? width
        const resolvedHeight = observed?.height ?? height
        const resolvedCodec = observed?.codec ?? (typeof item.codec === 'string' ? item.codec : null)
        if (
          observed
          && !observed.error
          && (
            resolvedDuration !== item.duration_ms
            || resolvedCapturedAt !== item.captured_at
            || resolvedWidth !== item.width
            || resolvedHeight !== item.height
            || resolvedCodec !== item.codec
          )
        ) {
          item.duration_ms = resolvedDuration
          item.captured_at = resolvedCapturedAt
          item.width = resolvedWidth
          item.height = resolvedHeight
          item.codec = resolvedCodec
        }
        return {
          id: takeId,
          location: item.location,
          source_camera_path: item.source_camera_path,
          markers: Array.isArray(item.markers) ? validateDirectorTakeMarkers(item.markers) : [],
          kind: item.type === 'photo' ? 'photo' as const : 'video' as const,
          created_at: typeof item.created_at === 'string'
            ? item.created_at
            : typeof item.captured_at === 'string'
              ? item.captured_at
              : new Date(0).toISOString(),
          captured_at: resolvedCapturedAt,
          duration_ms: resolvedDuration,
          width: resolvedWidth,
          height: resolvedHeight,
          codec: resolvedCodec,
          file_name: typeof item.file_name === 'string' ? item.file_name : fileName.replace(/^\d+_/, ''),
          mime_type: item.type === 'photo' ? 'image/jpeg' : 'video/mp4',
          size_bytes: available && absolutePath ? (await fs.stat(absolutePath)).size : null,
          available,
          selected_range: item.selected_range && typeof item.selected_range === 'object'
            ? item.selected_range as { start_ms: number; end_ms: number }
            : null,
          stream_path: available ? absolutePath : null,
          stream_url: fileUrl,
          download_path: available ? absolutePath : null,
          download_url: fileUrl,
        }
      }))
      const attributes = Array.isArray(shot.attributes)
        ? shot.attributes
            .filter((attribute): attribute is Record<string, unknown> =>
              !!attribute && typeof attribute === 'object')
            .filter((attribute) => typeof attribute.name === 'string' && attribute.name.trim())
            .map((attribute, attributeIndex) => ({
              id: typeof attribute.id === 'string' && attribute.id
                ? attribute.id
                : `${shot.id ?? shotIndex}-attribute-${attributeIndex}`,
              name: (attribute.name as string).trim(),
              description: typeof attribute.description === 'string' ? attribute.description : '',
            }))
        : [
            ...(typeof shot.visual_description === 'string' && shot.visual_description.trim()
              ? [{
                  id: `${shot.id ?? shotIndex}-legacy-visual`,
                  name: '画面说明',
                  description: shot.visual_description,
                }]
              : []),
            ...(typeof shot.movement_description === 'string' && shot.movement_description.trim()
              ? [{
                  id: `${shot.id ?? shotIndex}-legacy-movement`,
                  name: '运镜说明',
                  description: shot.movement_description,
                }]
              : []),
          ]
      return {
        id: typeof shot.id === 'string' ? shot.id : `local-shot-${shotIndex}`,
        order: typeof shot.order === 'number' ? shot.order : shotIndex + 1,
        name: typeof shot.name === 'string' ? shot.name : `镜头 ${shotIndex + 1}`,
        attributes,
        shot_recipe: shot.shot_recipe,
        remark: typeof shot.remark === 'string' ? shot.remark : '',
        visual_description: legacyShotAttribute(
          { attributes },
          ['画面说明', '画面', '目标', '拍摄目标'],
        ),
        movement_description: legacyShotAttribute(
          { attributes },
          ['运镜说明', '运镜', '相机运动'],
        ),
        duration_ms: typeof shot.duration_ms === 'number' ? shot.duration_ms : 5000,
        completed_takes: takes.filter((take) => take.available).length,
        takes,
      }
    }))
    const rawPlanAttributes = Array.isArray(raw.attributes)
      ? raw.attributes
          .filter((attribute): attribute is Record<string, unknown> =>
            !!attribute
            && typeof attribute === 'object'
            && typeof attribute.name === 'string'
            && attribute.name.trim().length > 0)
      : []
    const planAttributes: DirectorLanPlanAttribute[] = rawPlanAttributes.length > 0
      ? rawPlanAttributes.map((attribute, index) => ({
          id: typeof attribute.id === 'string' && attribute.id
            ? attribute.id
            : `${raw.plan_id}-attribute-${index}`,
          name: (attribute.name as string).trim(),
        }))
      : (shots[0]?.attributes ?? []).map((attribute, index) => ({
          id: attribute.id || `${raw.plan_id}-attribute-${index}`,
          name: attribute.name,
        }))
    return {
      id: raw.plan_id,
      title: typeof raw.title === 'string' ? raw.title : path.basename(directory),
      main_content: typeof raw.main_content === 'string' ? raw.main_content : '',
      created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date(0).toISOString(),
      updated_at: typeof raw.updated_at === 'string'
        ? raw.updated_at
        : typeof raw.created_at === 'string'
          ? raw.created_at
          : new Date(0).toISOString(),
      revision: typeof raw.revision === 'number' && Number.isSafeInteger(raw.revision)
        ? raw.revision
        : 0,
      synced_revision: typeof raw.synced_revision === 'number' && Number.isSafeInteger(raw.synced_revision)
        ? raw.synced_revision
        : undefined,
      synced_signature: typeof raw.synced_signature === 'string'
        ? raw.synced_signature
        : undefined,
      remote_origin: typeof raw.remote_origin === 'string' ? raw.remote_origin : undefined,
      pending_create: raw.pending_create === true,
      agent_creation_receipt: receipt(raw.agent_creation_receipt),
      agent_write_receipt: receipt(raw.agent_write_receipt),
      pending_shot_ids: Array.isArray(raw.pending_shot_ids) ? raw.pending_shot_ids.filter((id): id is string => typeof id === 'string') : [],
      pending_take_ids: Array.isArray(raw.pending_take_ids) ? raw.pending_take_ids.filter((id): id is string => typeof id === 'string') : [],
      deleted_local_take_ids: [...deletedLocalTakeIds],
      attributes: planAttributes,
      shot_count: shots.length,
      completed_shot_count: shots.filter((shot) => shot.takes.some((take) => take.available)).length,
      take_count: shots.reduce((total, shot) => total + shot.takes.length, 0),
      archive_url: '',
      source: 'local',
      local_directory: directory,
      shots,
    }
  } catch {
    return null
  }
}

export async function listLocalDirectorPlans(root: string, probeMediaOne?: (request: DirectorLabProbeRequest) => Promise<DirectorLabMediaMetadata>): Promise<DirectorLabDownloadPlanRequest['plan'][]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const plans = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => localPlanFromManifest(path.join(root, entry.name, 'manifest.json'), probeMediaOne)))
  return plans
    .filter((plan): plan is DirectorLabDownloadPlanRequest['plan'] => Boolean(plan))
    .map((plan) => ({ ...plan, local_content_signature: directorPlanContentSignature(plan) }))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
}
