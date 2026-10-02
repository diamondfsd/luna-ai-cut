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
import { lunaKaHttpClient } from '../network/lunaka_http_client'
import { getDirectorPlanDir, getSettings } from '../storage/fileService'
import { discoverDirectorServices } from '../features/director-lab/directorLabDiscovery'
import { registerDirectorLocalImport } from '../features/director-lab/directorLabLocalImport'
import { registerDirectorThumbnail } from '../features/director-lab/directorLabThumbnail'
import { persistDirectorDownloads } from '../features/director-lab/directorLabDownloadStorage'
import { fileExists, listLocalDirectorPlans } from '../features/director-lab/directorLabPlanReader'
import {
  mediaFileName,
  mediaFolder,
  planDirectory,
  reconcileLocalDirectorPlan,
  safePathPart,
} from '../features/director-lab/directorLabPlanStorage'
import { getFfmpegPath, getFfprobePath } from '../platform/ffmpeg/pipeline'

const previewTasks = new Map<string, Promise<DirectorLabPreviewResult>>()
const metadataCache = new Map<string, DirectorLabMediaMetadata>()
const metadataTasks = new Map<string, Promise<DirectorLabMediaMetadata>>()

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
  const planRequest = request.plan
    ? validateDownloadPlanRequest({ plan: request.plan, metadata: request.metadata })
    : null
  if (planRequest && planRequest.plan.title !== request.planTitle) {
    throw new Error('计划名称与素材不匹配')
  }
  if (planRequest && (typeof request.takeId !== 'string' || !request.takeId.trim())) {
    throw new Error('素材标识无效')
  }
  if (planRequest && !planRequest.plan.shots.some((shot) => shot.takes.some((take) => take.id === request.takeId))) {
    throw new Error('素材不属于当前计划')
  }
  return {
    operationId: typeof request.operationId === 'string' ? request.operationId : undefined,
    url: request.url,
    fileName: request.fileName,
    planTitle: request.planTitle,
    ...(planRequest ? {
      plan: planRequest.plan,
      takeId: request.takeId,
      metadata: planRequest.metadata,
    } : {}),
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

async function downloadPlan(
  value: unknown,
  sender: Electron.WebContents,
): Promise<DirectorLabDownloadPlanResult> {
  const { plan, operationId = `plan-${Date.now()}`, metadata = {} } = validateDownloadPlanRequest(value)
  const settings = await getSettings()
  const local = (await listLocalPlans()).find((item) => item.id === plan.id)
  const directory = local?.local_directory ?? path.join(
    getDirectorPlanDir(settings),
    `${planDirectory(plan.title)}_${safePathPart(plan.id, 'plan')}`,
  )
  await fs.mkdir(directory, { recursive: true })
  const media = plan.shots.flatMap((shot) => shot.takes
    .map((take, index) => ({ shot, take, index }))
    .filter(({ take }) => take.available && take.download_url?.startsWith('http')))
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
  const downloaded = new Map<string, string>()
  for (const shot of plan.shots) {
    for (let index = 0; index < shot.takes.length; index += 1) {
      const take = shot.takes[index]
      if (!take.available || !take.download_url?.startsWith('http')) continue
      const folder = mediaFolder(shot.order, shot.name)
      const destination = path.join(
        directory,
        folder,
        mediaFileName(index + 1, take.file_name),
      )
      if (!await fileExists(destination)) await downloadToFileWithRetry({
        name: take.file_name,
        bytes: take.size_bytes,
        sourceUrl: take.download_url,
        headers: await lunaKaHttpClient.authorizationHeadersFor(take.download_url),
      }, destination)
      downloaded.set(take.id, destination)
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
  await persistDirectorDownloads(directory, plan, downloaded, metadata, listLocalPlans)
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

async function listLocalPlans(): Promise<DirectorLabDownloadPlanRequest['plan'][]> {
  return listLocalDirectorPlans(getDirectorPlanDir(await getSettings()), probeMediaOne)
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

async function probeMediaOne(request: DirectorLabProbeRequest): Promise<DirectorLabMediaMetadata> {
  const cached = metadataCache.get(request.url)
  if (cached) return { ...cached, takeId: request.takeId }
  const active = metadataTasks.get(request.url)
  if (active) return active.then((metadata) => ({ ...metadata, takeId: request.takeId }))

  const authorizationHeaders = await lunaKaHttpClient.authorizationHeadersFor(request.url)
  const headerBlock = Object.entries(authorizationHeaders)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('')
  const args = [
    '-v', 'error',
    '-rw_timeout', '15000000',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    request.url,
  ]
  if (headerBlock) args.splice(args.length - 1, 0, '-headers', headerBlock)
  const task = new Promise<DirectorLabMediaMetadata>((resolve) => {
    execFile(getFfprobePath(), args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
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
        const durationSeconds = [video?.duration, payload.format?.duration]
          .map(Number)
          .find((value) => Number.isFinite(value) && value > 0) ?? 0
        const creationTimes = [
          video?.tags?.creation_time,
          video?.tags?.['com.apple.quicktime.creationdate'],
          video?.tags?.creationdate,
          payload.format?.tags?.creation_time,
          payload.format?.tags?.['com.apple.quicktime.creationdate'],
          payload.format?.tags?.creationdate,
        ]
        const parsedCreationTime = creationTimes
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value) => new Date(value))
          .find((date) => !Number.isNaN(date.getTime())) ?? null
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
      const authorizationHeaders = await lunaKaHttpClient.authorizationHeadersFor(request.url)
      const headerBlock = Object.entries(authorizationHeaders)
        .map(([name, value]) => `${name}: ${value}\r\n`)
        .join('')
      const args = [
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
      ]
      if (headerBlock) args.splice(3, 0, '-headers', headerBlock)
      await runProcess(getFfmpegPath(), args)
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
  registerDirectorLocalImport(listLocalPlans)
  registerDirectorThumbnail()
  ipcMain.handle('director-lab:reconcile-local-plan', async (_event, value: unknown, resolveConflict: unknown) => {
    const { plan, metadata = {} } = validateDownloadPlanRequest({ plan: value })
    const settings = await getSettings()
    return reconcileLocalDirectorPlan(getDirectorPlanDir(settings), plan, metadata, resolveConflict === true)
  })
  ipcMain.handle('director-lab:prepare-preview', (_event, value: unknown) => preparePreview(value))
  ipcMain.handle('director-lab:probe-media', (_event, value: unknown) => probeMedia(value))
  ipcMain.handle('director-lab:download-plan', (event, value: unknown) => downloadPlan(value, event.sender))
  ipcMain.handle('director-lab:download', async (event, value: unknown): Promise<DirectorLabDownloadResult> => {
    const request = validateRequest(value)
    const operationId = request.operationId ?? `take-${Date.now()}`
    const settings = await getSettings()
    const fileName = safePathPart(request.fileName, 'director-media')
    const local = request.plan ? (await listLocalPlans()).find((item) => item.id === request.plan!.id) : null
    const planPath = local?.local_directory ?? path.join(getDirectorPlanDir(settings), request.plan
      ? `${planDirectory(request.planTitle)}_${safePathPart(request.plan.id, 'plan')}` : planDirectory(request.planTitle))
    const planEntry = request.plan && request.takeId
      ? request.plan.shots.flatMap((shot) => shot.takes.map((take, index) => ({ shot, take, index })))
        .find((entry) => entry.take.id === request.takeId)
      : null
    const shotOrder = Math.max(1, Math.round(planEntry?.shot.order ?? request.shotOrder ?? 1))
    const shotName = planEntry?.shot.name ?? request.shotName ?? 'shot'
    const takeIndex = (planEntry?.index ?? Math.max(0, Math.round((request.takeIndex ?? 1) - 1))) + 1
    const directory = path.join(
      planPath,
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
      headers: await lunaKaHttpClient.authorizationHeadersFor(request.url),
    }, destination)
    if (request.plan && request.takeId) {
      await persistDirectorDownloads(planPath, request.plan, new Map([[request.takeId, downloadedPath]]), request.metadata ?? {}, listLocalPlans)
    }
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
