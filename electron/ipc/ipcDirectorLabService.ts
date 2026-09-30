import { app, clipboard, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  DirectorLabDownloadRequest,
  DirectorLabDownloadResult,
  DirectorLabDownloadPlanRequest,
  DirectorLabDownloadPlanResult,
  DirectorLabDownloadProgress,
  DirectorLabPreviewRequest,
  DirectorLabPreviewResult,
  DirectorLabMediaMetadata,
  DirectorLabProbeRequest,
} from '../../src/shared/types'
import { downloadToFileWithRetry } from '../media/fileDownloadService'
import { getDirectorPlanDir, getSettings } from '../storage/fileService'
import { discoverDirectorServices } from '../features/director-lab/directorLabDiscovery'
import { getFfmpegPath, getFfprobePath } from '../platform/ffmpeg/pipeline'

const previewTasks = new Map<string, Promise<DirectorLabPreviewResult>>()
const metadataCache = new Map<string, DirectorLabMediaMetadata>()
const metadataTasks = new Map<string, Promise<DirectorLabMediaMetadata>>()

function safePathPart(value: string, fallback: string): string {
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

function validateRequest(value: unknown): DirectorLabDownloadRequest {
  if (!value || typeof value !== 'object') throw new Error('下载参数无效')
  const request = value as Partial<DirectorLabDownloadRequest>
  if (typeof request.url !== 'string' || !/^https?:\/\//i.test(request.url)) {
    throw new Error('下载地址无效')
  }
  if (typeof request.fileName !== 'string' || !request.fileName.trim()) {
    throw new Error('文件名无效')
  }
  if (typeof request.planTitle !== 'string') throw new Error('计划名称无效')
  return {
    operationId: typeof request.operationId === 'string' ? request.operationId : undefined,
    url: request.url,
    fileName: request.fileName,
    planTitle: request.planTitle,
    shotOrder: typeof request.shotOrder === 'number' ? request.shotOrder : undefined,
    shotName: typeof request.shotName === 'string' ? request.shotName : undefined,
    takeIndex: typeof request.takeIndex === 'number' ? request.takeIndex : undefined,
  }
}

function validateDownloadPlanRequest(value: unknown): DirectorLabDownloadPlanRequest {
  if (!value || typeof value !== 'object') throw new Error('计划下载参数无效')
  const plan = (value as { plan?: unknown }).plan
  if (!plan || typeof plan !== 'object') throw new Error('计划数据无效')
  const candidate = plan as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string' || !Array.isArray(candidate.shots)) {
    throw new Error('计划数据不完整')
  }
  return {
    operationId: typeof (value as Record<string, unknown>).operationId === 'string'
      ? (value as Record<string, string>).operationId
      : undefined,
    plan: candidate as unknown as DirectorLabDownloadPlanRequest['plan'],
    metadata: (value as { metadata?: unknown }).metadata && typeof (value as { metadata?: unknown }).metadata === 'object'
      ? (value as DirectorLabDownloadPlanRequest).metadata
      : undefined,
  }
}

function sendDownloadProgress(
  sender: Electron.WebContents,
  progress: DirectorLabDownloadProgress,
): void {
  if (!sender.isDestroyed()) sender.send('director-lab:download-progress', progress)
}

function mediaFolder(shotOrder: number, shotName: string): string {
  return path.join(
    'media',
    `${String(shotOrder).padStart(2, '0')}_${safePathPart(shotName, 'shot')}`,
  )
}

function mediaFileName(takeIndex: number, fileName: string): string {
  return `${String(takeIndex).padStart(2, '0')}_${safePathPart(fileName, 'media')}`
}

function planDirectory(planTitle: string): string {
  return safePathPart(planTitle, '导演计划')
}

function readmeForPlan(plan: DirectorLabDownloadPlanRequest['plan']): string {
  const lines = [
    `# ${plan.title}`,
    '',
    '拍摄计划素材包',
    '视频选取范围记录在 manifest.json 中，单位为毫秒；原始视频不会被裁剪或转码。',
    '',
    '## 镜头清单',
  ]
  plan.shots.forEach((shot, shotIndex) => {
    lines.push(
      '',
      `### ${shotIndex + 1}. ${shot.name}`,
      '',
      `- 画面说明：${shot.visual_description.trim() || '未填写'}`,
      `- 建议时长：${Math.round(shot.duration_ms / 1000)} 秒`,
      `- 运镜说明：${shot.movement_description.trim() || '未填写'}`,
    )
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

function manifestForPlan(
  plan: DirectorLabDownloadPlanRequest['plan'],
  metadata: Record<string, DirectorLabMediaMetadata> = {},
): string {
  return JSON.stringify({
    format: 'luna-director-plan-v1',
    plan_id: plan.id,
    title: plan.title,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    exported_at: new Date().toISOString(),
    shots: plan.shots.map((shot, shotIndex) => ({
      id: shot.id,
      order: shotIndex + 1,
      name: shot.name,
      visual_description: shot.visual_description,
      objective: shot.visual_description,
      duration_ms: shot.duration_ms,
      movement_description: shot.movement_description,
      media: shot.takes.map((take, takeIndex) => ({
        id: take.id,
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

async function downloadPlan(
  value: unknown,
  sender: Electron.WebContents,
): Promise<DirectorLabDownloadPlanResult> {
  const { plan, operationId = `plan-${Date.now()}`, metadata = {} } = validateDownloadPlanRequest(value)
  const settings = await getSettings()
  const directory = path.join(
    getDirectorPlanDir(settings),
    planDirectory(plan.title),
  )
  await fs.mkdir(directory, { recursive: true })
  const media = plan.shots.flatMap((shot) => shot.takes
    .map((take, index) => ({ shot, take, index }))
    .filter(({ take }) => take.available && take.download_url))
  let completedFiles = 0
  sendDownloadProgress(sender, {
    operationId,
    planId: plan.id,
    kind: 'plan',
    phase: 'preparing',
    completedFiles,
    totalFiles: media.length,
    percent: 0,
  })
  let fileCount = 0
  for (const shot of plan.shots) {
    for (let index = 0; index < shot.takes.length; index += 1) {
      const take = shot.takes[index]
      if (!take.available || !take.download_url) continue
      const folder = mediaFolder(shot.order, shot.name)
      const destination = path.join(
        directory,
        folder,
        mediaFileName(index + 1, take.file_name),
      )
      await downloadToFileWithRetry({
        name: take.file_name,
        bytes: take.size_bytes,
        sourceUrl: take.download_url,
      }, destination)
      fileCount += 1
      completedFiles += 1
      sendDownloadProgress(sender, {
        operationId,
        planId: plan.id,
        kind: 'plan',
        phase: 'downloading',
        completedFiles,
        totalFiles: media.length,
        currentFile: take.file_name,
        percent: media.length === 0 ? 100 : Math.round(completedFiles / media.length * 100),
      })
    }
  }
  sendDownloadProgress(sender, {
    operationId,
    planId: plan.id,
    kind: 'plan',
    phase: 'writing',
    completedFiles,
    totalFiles: media.length,
    percent: 100,
  })
  await Promise.all([
    fs.writeFile(path.join(directory, 'README.md'), readmeForPlan(plan), 'utf8'),
    fs.writeFile(path.join(directory, 'manifest.json'), manifestForPlan(plan, metadata), 'utf8'),
  ])
  sendDownloadProgress(sender, {
    operationId,
    planId: plan.id,
    kind: 'plan',
    phase: 'done',
    completedFiles,
    totalFiles: media.length,
    percent: 100,
  })
  return { directory, fileCount }
}

function validatePreviewRequest(value: unknown): DirectorLabPreviewRequest {
  if (!value || typeof value !== 'object') throw new Error('预览参数无效')
  const request = value as Partial<DirectorLabPreviewRequest>
  if (typeof request.url !== 'string' || !/^https?:\/\//i.test(request.url)) {
    throw new Error('预览地址无效')
  }
  if (typeof request.cacheKey !== 'string' || !request.cacheKey.trim()) {
    throw new Error('预览缓存标识无效')
  }
  return { url: request.url, cacheKey: request.cacheKey }
}

function validateProbeRequests(value: unknown): DirectorLabProbeRequest[] {
  if (!Array.isArray(value) || value.length === 0) return []
  if (value.length > 100) throw new Error('一次最多读取 100 段素材的元数据')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('素材探测参数无效')
    const request = item as Partial<DirectorLabProbeRequest>
    if (typeof request.takeId !== 'string' || !request.takeId.trim()) {
      throw new Error('素材标识无效')
    }
    if (typeof request.url !== 'string' || !/^(?:https?|file):\/\//i.test(request.url)) {
      throw new Error('素材探测地址无效')
    }
    return { takeId: request.takeId, url: request.url }
  })
}

interface LocalManifestMedia {
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
}

interface LocalManifestShot {
  id?: unknown
  name?: unknown
  order?: unknown
  visual_description?: unknown
  movement_description?: unknown
  duration_ms?: unknown
  media?: unknown
}

interface LocalManifest {
  format?: unknown
  plan_id?: unknown
  title?: unknown
  created_at?: unknown
  updated_at?: unknown
  shots?: unknown
}

function localPathForManifestMedia(planDirectory: string, mediaPath: string): string {
  return path.resolve(planDirectory, mediaPath.replace(/[\\/]+/g, path.sep))
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function localPlanFromManifest(manifestPath: string): Promise<DirectorLabDownloadPlanRequest['plan'] | null> {
  try {
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as LocalManifest
    if (raw.format !== 'luna-director-plan-v1' || typeof raw.plan_id !== 'string' || !Array.isArray(raw.shots)) {
      return null
    }
    const directory = path.dirname(manifestPath)
    let manifestChanged = false
    const shots = await Promise.all((raw.shots as LocalManifestShot[]).map(async (shot, shotIndex) => {
      const media = Array.isArray(shot.media) ? shot.media as LocalManifestMedia[] : []
      const takes = await Promise.all(media.map(async (item, takeIndex) => {
        const takeId = typeof item.id === 'string' ? item.id : `local-take-${shotIndex}-${takeIndex}`
        const relativePath = typeof item.path === 'string' ? item.path : null
        const absolutePath = relativePath ? localPathForManifestMedia(directory, relativePath) : null
        const available = absolutePath ? await fileExists(absolutePath) : false
        const fileUrl = available && absolutePath ? pathToFileURL(absolutePath).toString() : null
        const fileName = absolutePath ? path.basename(absolutePath) : `${shot.id ?? shotIndex}-${takeIndex}`
        const durationMs = typeof item.duration_ms === 'number' ? item.duration_ms : null
        const width = typeof item.width === 'number' ? item.width : null
        const height = typeof item.height === 'number' ? item.height : null
        const capturedAt = typeof item.captured_at === 'string' ? item.captured_at : null
        const needsProbe = available && item.type === 'video' && fileUrl && (
          durationMs == null || capturedAt == null || width == null || height == null
        )
        const observed = needsProbe
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
          manifestChanged = true
        }
        return {
          id: takeId,
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
          file_name: fileName.replace(/^\d+_/, ''),
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
      return {
        id: typeof shot.id === 'string' ? shot.id : `local-shot-${shotIndex}`,
        order: typeof shot.order === 'number' ? shot.order : shotIndex + 1,
        name: typeof shot.name === 'string' ? shot.name : `镜头 ${shotIndex + 1}`,
        visual_description: typeof shot.visual_description === 'string' ? shot.visual_description : '',
        movement_description: typeof shot.movement_description === 'string' ? shot.movement_description : '',
        duration_ms: typeof shot.duration_ms === 'number' ? shot.duration_ms : 5000,
        completed_takes: takes.filter((take) => take.available).length,
        takes,
      }
    }))
    if (manifestChanged) {
      const temporaryPath = `${manifestPath}.tmp`
      await fs.writeFile(temporaryPath, JSON.stringify(raw, null, 2), 'utf8')
      await fs.rename(temporaryPath, manifestPath)
    }
    return {
      id: raw.plan_id,
      title: typeof raw.title === 'string' ? raw.title : path.basename(directory),
      created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date(0).toISOString(),
      updated_at: typeof raw.updated_at === 'string'
        ? raw.updated_at
        : typeof raw.created_at === 'string'
          ? raw.created_at
          : new Date(0).toISOString(),
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

async function listLocalPlans(): Promise<DirectorLabDownloadPlanRequest['plan'][]> {
  const settings = await getSettings()
  const root = getDirectorPlanDir(settings)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const plans = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => localPlanFromManifest(path.join(root, entry.name, 'manifest.json'))))
  return plans
    .filter((plan): plan is DirectorLabDownloadPlanRequest['plan'] => Boolean(plan))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
}

interface ProbePayload {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    duration?: string
    tags?: Record<string, string>
  }>
  format?: {
    duration?: string
    tags?: Record<string, string>
  }
}

function probeMediaOne(request: DirectorLabProbeRequest): Promise<DirectorLabMediaMetadata> {
  const cached = metadataCache.get(request.url)
  if (cached) return Promise.resolve({ ...cached, takeId: request.takeId })
  const active = metadataTasks.get(request.url)
  if (active) return active.then((metadata) => ({ ...metadata, takeId: request.takeId }))

  const task = new Promise<DirectorLabMediaMetadata>((resolve) => {
    execFile(getFfprobePath(), [
      '-v', 'error',
      '-rw_timeout', '15000000',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      request.url,
    ], { encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve({
          takeId: request.takeId,
          durationMs: null,
          capturedAt: null,
          width: null,
          height: null,
          codec: null,
          error: error.message,
        })
        return
      }
      try {
        const payload = JSON.parse(stdout) as ProbePayload
        const video = payload.streams?.find((stream) => stream.codec_type === 'video')
        const durationSeconds = Number(video?.duration ?? payload.format?.duration)
        const creationTime = video?.tags?.creation_time ?? payload.format?.tags?.creation_time ?? null
        const parsedCreationTime = creationTime ? new Date(creationTime) : null
        resolve({
          takeId: request.takeId,
          durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0
            ? Math.round(durationSeconds * 1000)
            : null,
          capturedAt: parsedCreationTime && !Number.isNaN(parsedCreationTime.getTime())
            ? parsedCreationTime.toISOString()
            : null,
          width: Number.isFinite(video?.width) ? video?.width ?? null : null,
          height: Number.isFinite(video?.height) ? video?.height ?? null : null,
          codec: video?.codec_name ?? null,
          error: null,
        })
      } catch (parseError) {
        resolve({
          takeId: request.takeId,
          durationMs: null,
          capturedAt: null,
          width: null,
          height: null,
          codec: null,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        })
      }
    })
  })

  metadataTasks.set(request.url, task)
  return task.then((metadata) => {
    if (!metadata.error) metadataCache.set(request.url, metadata)
    return metadata
  }).finally(() => {
    metadataTasks.delete(request.url)
  })
}

async function probeMedia(value: unknown): Promise<DirectorLabMediaMetadata[]> {
  const requests = validateProbeRequests(value)
  const results: DirectorLabMediaMetadata[] = []
  const concurrency = 4
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, requests.length) }, async () => {
    while (cursor < requests.length) {
      const request = requests[cursor]
      cursor += 1
      results.push(await probeMediaOne(request))
    }
  })
  await Promise.all(workers)
  return results
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let errorText = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      errorText = `${errorText}${chunk}`.slice(-16_384)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(errorText.trim() || `ffmpeg exited with code ${code}`))
    })
  })
}

async function preparePreview(value: unknown): Promise<DirectorLabPreviewResult> {
  const request = validatePreviewRequest(value)
  const key = createHash('sha256').update(`${request.cacheKey}\n${request.url}`).digest('hex')
  const existing = previewTasks.get(key)
  if (existing) return existing

  const task = (async () => {
    const directory = path.join(app.getPath('userData'), 'director-lab', 'preview')
    const outputPath = path.join(directory, `${key}.mp4`)
    const temporaryPath = `${outputPath}.tmp.mp4`
    try {
      const stat = await fs.stat(outputPath)
      if (stat.size > 0) return { url: pathToFileURL(outputPath).toString(), cached: true }
    } catch {
      // Cache miss.
    }

    await fs.mkdir(directory, { recursive: true })
    await fs.rm(temporaryPath, { force: true })
    try {
      await runProcess(getFfmpegPath(), [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', request.url,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-vf', "scale='min(1280,iw)':-2",
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '26',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        temporaryPath,
      ])
      await fs.rename(temporaryPath, outputPath)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true })
      throw error
    }
    return { url: pathToFileURL(outputPath).toString(), cached: false }
  })()

  previewTasks.set(key, task)
  try {
    return await task
  } finally {
    previewTasks.delete(key)
  }
}

export function register(): void {
  ipcMain.handle('clipboard:write-text', (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('复制内容无效')
    clipboard.writeText(value)
  })
  ipcMain.handle('director-lab:discover', () => discoverDirectorServices())
  ipcMain.handle('director-lab:list-local-plans', () => listLocalPlans())
  ipcMain.handle('director-lab:prepare-preview', (_event, value: unknown) => preparePreview(value))
  ipcMain.handle('director-lab:probe-media', (_event, value: unknown) => probeMedia(value))
  ipcMain.handle('director-lab:download-plan', (event, value: unknown) => downloadPlan(value, event.sender))
  ipcMain.handle('director-lab:download', async (event, value: unknown): Promise<DirectorLabDownloadResult> => {
    const request = validateRequest(value)
    const operationId = request.operationId ?? `take-${Date.now()}`
    const settings = await getSettings()
    const fileName = safePathPart(request.fileName, 'director-media')
    const shotOrder = Math.max(1, Math.round(request.shotOrder ?? 1))
    const shotName = request.shotName ?? 'shot'
    const takeIndex = Math.max(1, Math.round(request.takeIndex ?? 1))
    const directory = path.join(
      getDirectorPlanDir(settings),
      planDirectory(request.planTitle),
      mediaFolder(shotOrder, shotName),
    )
    const destination = path.join(directory, mediaFileName(takeIndex, fileName))
    sendDownloadProgress(event.sender, {
      operationId,
      planId: request.planTitle,
      kind: 'take',
      phase: 'preparing',
      completedFiles: 0,
      totalFiles: 1,
      currentFile: fileName,
      percent: 0,
    })
    const downloadedPath = await downloadToFileWithRetry({
      name: fileName,
      bytes: null,
      sourceUrl: request.url,
    }, destination)
    sendDownloadProgress(event.sender, {
      operationId,
      planId: request.planTitle,
      kind: 'take',
      phase: 'done',
      completedFiles: 1,
      totalFiles: 1,
      currentFile: fileName,
      percent: 100,
    })
    return { path: downloadedPath, fileName }
  })
}
