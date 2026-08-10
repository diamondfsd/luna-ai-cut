import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import fs from 'node:fs'
import { promisify } from 'node:util'
import type { WorkspaceBeautyAnalysisRequest, WorkspaceInstanceSegmentationRequest, WorkspaceMaskTrackingRequest, WorkspaceMediaAsset, WorkspaceObjectRemovalRequest, WorkspaceProject, WorkspaceSegmentationRequest, WorkspaceVisualAnalysisRequest } from '../src/shared/types'
import { createExportTask, updateTaskItemProgress } from './exportStubs'
import probe from 'probe-image-size'
import { getSettings } from './fileService'
import { safeName } from './filePathUtils'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { logMainError, logMainInfo, logMainWarn } from './loggerService'
import { combineLivePhoto, isGoogleMotionPhoto } from './livePhotoService'
import { readWorkspaceColorMetadata } from './workspaceColorMetadataService'
import { getVideoFrameRate } from './mediaMetadataService'
import {
  addAssetsToWorkspaceProject,
  createWorkspaceProject,
  deleteWorkspaceProject,
  discardWorkspaceRemovalFiles,
  listWorkspaceProjects,
  loadWorkspaceRemovalMask,
  renameWorkspaceProject,
  saveWorkspaceProject,
} from './workspaceProjectService'
import {
  listColorPresets,
  saveColorPreset,
  deleteColorPreset,
  renameColorPreset,
} from './colorPresetsService'
import { loadWorkspacePreview } from './workspacePreviewService'
import { loadTrimThumbnailCache, saveTrimThumbnailCache } from './trimThumbnailCacheService'
import { getModelCacheStatus, loadModel, loadSamModel, type ModelId } from './modelLoader'
import { automaticSegmentationTarget, isSamSegmentationModel, modelForSegmentationRequest, SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS, type SegmentationModelId } from '../src/shared/segmentationModels'
import { segmentSamInWorker } from './samSegmentationService'
import { prepareSemanticRefinementGuide, segmentSemanticInWorker } from './semanticSegmentationService'
import { segmentSpecializedInWorker } from './specializedSegmentationService'
import { cleanupUnreferencedColorMasks, deleteColorMask, loadColorMask, saveColorMask } from './colorMaskService'
import { SegmentationTaskRegistry } from './segmentationTaskRegistry'
import { beginForegroundSegmentation } from './segmentationModelPrefetchService'
import { trackMaskInWorker } from './maskTrackingService'
import { removeObject } from './inpaintService'
import { inpaintWorkerService } from './inpaintWorkerService'
import { analyzeBeauty } from './beautyAnalysisService'
import { analyzeVisualEvidence } from './aiEditingVisualEvidenceService'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.lrv'])
const execFileAsync = promisify(execFile)

interface FfprobeVideoEntry {
  media_type?: unknown
  codec_type?: unknown
  width?: unknown
  height?: unknown
  side_data_list?: Array<{ rotation?: unknown }>
  tags?: Record<string, unknown>
}

function normalizeRotation(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return null
  const rotation = ((Math.round(numeric) % 360) + 360) % 360
  return rotation === 90 || rotation === 270 ? rotation : null
}

function rotationFromSideData(value: FfprobeVideoEntry | null | undefined): number | null {
  const sideData = value?.side_data_list ?? []
  for (const item of sideData) {
    const rotation = normalizeRotation(item?.rotation)
    if (rotation) return rotation
  }
  return null
}

function rotationFromTags(value: FfprobeVideoEntry | null | undefined): number | null {
  const orientation = String(value?.tags?.Orientation ?? value?.tags?.orientation ?? '').trim()
  if (orientation === '6') return 90
  if (orientation === '8') return 270
  return normalizeRotation(value?.tags?.rotate ?? value?.tags?.Rotate)
}

function displayRotation(frame: FfprobeVideoEntry | undefined, stream: FfprobeVideoEntry | undefined): number {
  return rotationFromSideData(frame)
    ?? rotationFromSideData(stream)
    ?? rotationFromTags(frame)
    ?? rotationFromTags(stream)
    ?? 0
}

async function probeDisplayResolution(filePath: string): Promise<{ width: number; height: number; rotation: number; encodedWidth: number; encodedHeight: number }> {
  const ffprobeBin = getFfprobePath()
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)

  // 先用 ffprobe 探测（适用于视频 / Live Photo）
  try {
    const { stdout } = await execFileAsync(ffprobeBin, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_frames',
      '-read_intervals', '%+#1',
      filePath,
    ])
    const parsed = JSON.parse(stdout) as { frames?: FfprobeVideoEntry[]; streams?: FfprobeVideoEntry[] }
    const frame = parsed.frames?.find((item) => item.media_type === 'video')
    const stream = parsed.streams?.find((item) => item.codec_type === 'video')
    const encodedWidth = Number(frame?.width ?? stream?.width ?? 0)
    const encodedHeight = Number(frame?.height ?? stream?.height ?? 0)
    if (Number.isFinite(encodedWidth) && Number.isFinite(encodedHeight) && encodedWidth > 0 && encodedHeight > 0) {
      const rotation = displayRotation(frame, stream)
      const shouldSwap = rotation === 90 || rotation === 270
      return {
        width: shouldSwap ? encodedHeight : encodedWidth,
        height: shouldSwap ? encodedWidth : encodedHeight,
        rotation,
        encodedWidth,
        encodedHeight,
      }
    }
  } catch {
    // ffprobe 失败，回退到图片探测
  }

  // ffprobe 无视频流 → 尝试用 probe-image-size 解析图片分辨率
  const buf = await fs.promises.readFile(filePath, { flag: 'r' }).catch(() => null)
  if (buf) {
    try {
      const result = probe.sync(buf)
      if (result && result.width > 0 && result.height > 0) {
        return {
          width: result.width,
          height: result.height,
          rotation: 0,
          encodedWidth: result.width,
          encodedHeight: result.height,
        }
      }
    } catch {
      // probe 也失败
    }
  }

  throw new Error(`无法获取文件分辨率: ${filePath}`)
}

export function register(): void {
  const segmentationTasks = new SegmentationTaskRegistry()
  const trackingTasks = new SegmentationTaskRegistry()
  const removalTasks = new SegmentationTaskRegistry()
  const watchedSenders = new Set<number>()
  const watchSender = (sender: Electron.WebContents): void => {
    if (watchedSenders.has(sender.id)) return
    watchedSenders.add(sender.id)
    const cancelSenderTasks = (): void => {
      segmentationTasks.cancelOwner(sender.id)
      trackingTasks.cancelOwner(sender.id)
      removalTasks.cancelOwner(sender.id)
      inpaintWorkerService.release(sender.id)
    }
    sender.on('render-process-gone', cancelSenderTasks)
    sender.on('did-start-navigation', (_event, _url, isSameDocument, isMainFrame) => {
      if (isMainFrame && !isSameDocument) cancelSenderTasks()
    })
    sender.once('destroyed', () => {
      cancelSenderTasks()
      watchedSenders.delete(sender.id)
    })
  }
  ipcMain.handle('workspace:loadTrimThumbnailCache', async (_event, videoPath: string, duration: number) => {
    return loadTrimThumbnailCache(videoPath, duration)
  })

  ipcMain.handle('workspace:saveTrimThumbnailCache', async (_event, videoPath: string, duration: number, bytes: ArrayBuffer) => {
    await saveTrimThumbnailCache(videoPath, duration, bytes)
  })

  ipcMain.handle('workspace:saveColorMask', async (_event, projectId: string, assetId: string, width: number, height: number, bytes: ArrayBuffer, feather: number) => {
    const settings = await getSettings()
    return saveColorMask(settings.baseDir, projectId, assetId, width, height, bytes, feather)
  })

  ipcMain.handle('workspace:loadColorMask', async (_event, projectId: string, filePath: string) => {
    const settings = await getSettings()
    return loadColorMask(settings.baseDir, projectId, filePath)
  })

  ipcMain.handle('workspace:deleteColorMask', async (_event, projectId: string, filePath: string) => {
    const settings = await getSettings()
    await deleteColorMask(settings.baseDir, projectId, filePath)
  })

  ipcMain.handle('workspace:cleanupColorMasks', async (_event, projectId: string, retainedPaths: string[]) => {
    const settings = await getSettings()
    return cleanupUnreferencedColorMasks(settings.baseDir, projectId, retainedPaths)
  })

  ipcMain.handle('workspace:loadPreview', async (_event, filePath: string) => {
    return loadWorkspacePreview(filePath)
  })

  ipcMain.handle('workspace:getMediaFormatInfo', async (_event, filePath: string) => {
    const extension = path.extname(filePath).toLowerCase()
    const rawPath = extension === '.jpg' || extension === '.jpeg'
      ? path.join(path.dirname(filePath), `${path.basename(filePath, extension)}.dng`)
      : null
    const raw = rawPath ? await fs.promises.access(rawPath).then(() => true).catch(() => false) : false
    if (!VIDEO_EXTENSIONS.has(extension)) return { dolbyVision: false, iLog: false, raw }

    const info = await getVideoFrameRate({
      kind: 'video',
      sourceUrl: filePath,
      url: filePath,
      downloadFilePath: filePath,
      localPath: filePath,
      cacheFilePath: null,
    }, filePath)
    return { dolbyVision: info.dolbyVision === true, iLog: info.iLog === true, raw }
  })

  ipcMain.handle('workspace:getMediaResolution', async (_event, filePath: string) => {
    // 统一使用 ffprobe（非阻塞，只读文件头），避免同步解码大图阻塞主进程。
    // 同时读取 stream 与首帧，按 Rust 渲染层同样的规则处理视频 display matrix 和图片 Orientation。
    try {
      const resolution = await probeDisplayResolution(filePath)
      return { width: resolution.width, height: resolution.height }
    } catch (error) {
      logMainError(`[workspace:getMediaResolution] FAILED filePath=${filePath} error=${error instanceof Error ? error.message : String(error)}`)
      throw error instanceof Error ? error : new Error(`无法获取文件分辨率: ${filePath}`)
    }
  })

  ipcMain.handle('workspace:getVideoDuration', async (_event, filePath: string) => {
    const { stdout } = await execFileAsync(getFfprobePath(), [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { encoding: 'utf-8' })
    const duration = Number(stdout.trim())
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
    return duration
  })

  ipcMain.handle('workspace:cancelMaskTracking', (event, requestId: string) => {
    if (typeof requestId !== 'string' || requestId.length === 0) return false
    return trackingTasks.cancel(event.sender.id, requestId)
  })

  ipcMain.handle('workspace:cancelObjectRemoval', (event, requestId: string) => {
    if (typeof requestId !== 'string' || requestId.length === 0) return false
    return removalTasks.cancel(event.sender.id, requestId)
  })

  ipcMain.handle('workspace:prepareObjectRemoval', async (event) => {
    watchSender(event.sender)
    await inpaintWorkerService.acquire(event.sender.id)
  })

  ipcMain.handle('workspace:releaseObjectRemoval', (event) => {
    removalTasks.cancelOwner(event.sender.id)
    inpaintWorkerService.release(event.sender.id)
  })

  ipcMain.handle('workspace:discardObjectRemovalFiles', async (_event, projectId: string, filePaths: string[]) => {
    if (!Array.isArray(filePaths) || filePaths.length > 100 || filePaths.some((filePath) => typeof filePath !== 'string')) throw new Error('待清理的消除结果无效')
    const settings = await getSettings()
    await discardWorkspaceRemovalFiles(settings.baseDir, projectId, filePaths)
  })

  ipcMain.handle('workspace:loadObjectRemovalMask', async (_event, projectId: string, filePath: string, expectedBytes: number) => {
    const settings = await getSettings()
    return loadWorkspaceRemovalMask(settings.baseDir, projectId, filePath, Math.round(Number(expectedBytes)))
  })

  ipcMain.handle('workspace:removeObject', async (event, request: WorkspaceObjectRemovalRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) throw new Error('消除任务标识无效')
    if (typeof request.filePath !== 'string' || request.filePath.length === 0 || VIDEO_EXTENSIONS.has(path.extname(request.filePath).toLowerCase())) throw new Error('对象消除当前仅支持图片')
    const maskWidth = Math.round(Number(request.maskWidth))
    const maskHeight = Math.round(Number(request.maskHeight))
    if (maskWidth <= 0 || maskHeight <= 0 || maskWidth * maskHeight > 1_048_576) throw new Error('消除选区尺寸无效')
    request.edgeExpansion = Math.max(0, Math.min(32, Math.round(Number(request.edgeExpansion))))
    request.feather = Math.max(0, Math.min(24, Math.round(Number(request.feather))))
    request.quality = request.quality === 'fast' ? 'fast' : 'high'
    const task = removalTasks.begin(event.sender.id, request.requestId)
    watchSender(event.sender)
    try {
      const [settings, resolution] = await Promise.all([getSettings(), probeDisplayResolution(request.filePath)])
      return await removeObject(request, settings.baseDir, resolution.width, resolution.height, event.sender.id, task.controller.signal)
    } finally {
      removalTasks.finish(task)
    }
  })

  ipcMain.handle('workspace:trackMask', async (event, request: WorkspaceMaskTrackingRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) throw new Error('蒙版追踪任务标识无效')
    if (typeof request.filePath !== 'string' || request.filePath.length === 0 || !VIDEO_EXTENSIONS.has(path.extname(request.filePath).toLowerCase())) throw new Error('蒙版追踪仅支持视频素材')
    if (request.direction !== 'forward' && request.direction !== 'backward') throw new Error('蒙版追踪方向无效')
    const anchorTime = Number(request.anchorTime)
    const requestedEndTime = request.endTime == null ? undefined : Number(request.endTime)
    const maskWidth = Math.round(Number(request.maskWidth))
    const maskHeight = Math.round(Number(request.maskHeight))
    const maskBytes = request.maskBytes instanceof Uint8Array ? request.maskBytes : new Uint8Array(request.maskBytes)
    const mode = request.mode === 'dense-mask' ? 'dense-mask' : 'similarity'
    const guideMaskBytes = request.guideMaskBytes instanceof Uint8Array
      ? request.guideMaskBytes
      : request.guideMaskBytes ? new Uint8Array(request.guideMaskBytes) : undefined
    const guideMaskWidth = Math.round(Number(request.guideMaskWidth ?? maskWidth))
    const guideMaskHeight = Math.round(Number(request.guideMaskHeight ?? maskHeight))
    if (!Number.isFinite(anchorTime) || anchorTime < 0) throw new Error('蒙版追踪起始时间无效')
    if (requestedEndTime != null && !Number.isFinite(requestedEndTime)) throw new Error('蒙版追踪结束时间无效')
    if (maskWidth <= 0 || maskHeight <= 0 || maskWidth * maskHeight > 16_777_216 || maskBytes.byteLength !== maskWidth * maskHeight) throw new Error('蒙版追踪数据无效')
    if (mode === 'dense-mask' && (!guideMaskBytes || guideMaskWidth <= 0 || guideMaskHeight <= 0 || guideMaskWidth * guideMaskHeight > 16_777_216 || guideMaskBytes.byteLength !== guideMaskWidth * guideMaskHeight)) throw new Error('人物轮廓追踪数据无效')
    let selectedPixels = 0
    for (const value of maskBytes) if (value >= 16) selectedPixels += 1
    if (selectedPixels < 16) throw new Error('请先创建有效蒙版再开始追踪')

    const task = trackingTasks.begin(event.sender.id, request.requestId)
    watchSender(event.sender)
    try {
      const [duration, resolution] = await Promise.all([
        (async () => {
          const { stdout } = await execFileAsync(getFfprobePath(), ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', request.filePath], { encoding: 'utf-8' })
          return Number(stdout.trim())
        })(),
        probeDisplayResolution(request.filePath),
      ])
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
      const boundedAnchorTime = Math.min(anchorTime, duration)
      const endTime = requestedEndTime == null ? undefined : Math.min(Math.max(requestedEndTime, 0), duration)
      if (request.direction === 'forward' && endTime != null && endTime < boundedAnchorTime) throw new Error('蒙版追踪结束时间不能早于起始时间')
      const result = await trackMaskInWorker({
        ...request,
        anchorTime: boundedAnchorTime,
        endTime,
        maskWidth,
        maskHeight,
        maskBytes,
        mode,
        guideMaskBytes,
        guideMaskWidth,
        guideMaskHeight,
        duration,
        sourceWidth: resolution.width,
        sourceHeight: resolution.height,
      }, getFfmpegPath(), task.controller.signal, (progress) => {
        if (!trackingTasks.isActive(task) || event.sender.isDestroyed()) return
        event.sender.send('workspace:mask-tracking-progress', { requestId: request.requestId, direction: request.direction, ...progress })
      })
      return result
    } finally {
      trackingTasks.finish(task)
    }
  })

  ipcMain.handle('workspace:isLivePhoto', async (_event, filePath: string) => {
    return isGoogleMotionPhoto(filePath)
  })
  ipcMain.handle('workspace:readColorMetadata', async (_event, filePath: string) => {
    return readWorkspaceColorMetadata(filePath)
  })
  ipcMain.handle('workspace:getSegmentationModelStatus', async (_event, modelId: SegmentationModelId) => {
    return getModelCacheStatus(modelId)
  })
  ipcMain.handle('workspace:prepareSegmentationModels', async (_event, modelIds: SegmentationModelId[]) => {
    if (!Array.isArray(modelIds)) throw new Error('自动选择模型列表无效')
    const availableModelIds = new Set<SegmentationModelId>([
      ...SEGMENTATION_MODELS.map((model) => model.id),
      ...SPECIALIZED_SEGMENTATION_MODELS.map((model) => model.id),
    ])
    const uniqueModelIds = [...new Set(modelIds)].filter((modelId) => availableModelIds.has(modelId))
    for (const modelId of uniqueModelIds) await loadModel(modelId as ModelId)
  })
  ipcMain.handle('workspace:cancelSegmentation', (event, requestId: string) => {
    if (typeof requestId !== 'string' || requestId.length === 0) return false
    return segmentationTasks.cancel(event.sender.id, requestId)
  })
  ipcMain.handle('workspace:analyzeBeauty', async (event, request: WorkspaceBeautyAnalysisRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) throw new Error('美颜任务标识无效')
    if (typeof request.filePath !== 'string' || request.filePath.length === 0) throw new Error('美颜素材无效')
    const frameTime = request.frameTime == null ? undefined : Number(request.frameTime)
    if (frameTime !== undefined && (!Number.isFinite(frameTime) || frameTime < 0)) throw new Error('美颜取帧时间无效')
    const task = segmentationTasks.begin(event.sender.id, request.requestId)
    watchSender(event.sender)
    const reportProgress = (phase: 'model' | 'preparing' | 'recognizing', label: string, percent: number | null): void => {
      if (!segmentationTasks.isActive(task) || event.sender.isDestroyed()) return
      event.sender.send('workspace:segmentation-progress', { requestId: request.requestId, phase, label, percent })
    }
    try {
      return await analyzeBeauty(request.requestId, request.filePath, task.controller.signal, reportProgress, frameTime, request.videoFrame === true)
    } finally {
      segmentationTasks.finish(task)
    }
  })
  ipcMain.handle('workspace:analyzeVisualEvidence', async (event, request: WorkspaceVisualAnalysisRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) throw new Error('画面分析任务无效')
    if (typeof request.filePath !== 'string' || request.filePath.length === 0) throw new Error('画面分析素材无效')
    if (!Number.isFinite(request.durationSeconds) || request.durationSeconds <= 0 || request.durationSeconds > 12 * 60 * 60) throw new Error('画面分析时长无效')
    const task = segmentationTasks.begin(event.sender.id, request.requestId)
    const finishForegroundSegmentation = beginForegroundSegmentation('yolo26s-seg')
    watchSender(event.sender)
    const reportProgress = (progress: { label: string; percent: number }): void => {
      if (!segmentationTasks.isActive(task) || event.sender.isDestroyed()) return
      event.sender.send('workspace:segmentation-progress', {
        requestId: request.requestId,
        phase: 'recognizing',
        ...progress,
      })
    }
    try {
      return await analyzeVisualEvidence(request, task.controller.signal, reportProgress)
    } finally {
      segmentationTasks.finish(task)
      finishForegroundSegmentation()
    }
  })
  ipcMain.handle('workspace:segmentInstances', async (event, request: WorkspaceInstanceSegmentationRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) throw new Error('划选任务标识无效')
    if (typeof request.filePath !== 'string' || request.filePath.length === 0 || VIDEO_EXTENSIONS.has(path.extname(request.filePath).toLowerCase())) throw new Error('划选当前仅支持图片')
    const { requestId, filePath } = request
    const task = segmentationTasks.begin(event.sender.id, requestId)
    const { signal } = task.controller
    const finishForegroundSegmentation = beginForegroundSegmentation('yolo26s-seg')
    watchSender(event.sender)
    const reportProgress = (phase: 'model' | 'preparing' | 'recognizing', label: string, percent: number | null): void => {
      if (!segmentationTasks.isActive(task) || event.sender.isDestroyed()) return
      event.sender.send('workspace:segmentation-progress', { requestId, phase, label, percent })
    }
    try {
      const totalStartedAt = performance.now()
      const modelStartedAt = performance.now()
      reportProgress('model', '正在准备模型', null)
      const model = await loadModel('yolo26s-seg', (progress) => reportProgress(
        'model',
        progress.completedBytes === progress.totalBytes ? '正在校验模型' : '正在下载模型',
        progress.totalBytes > 0 ? Math.round(progress.completedBytes / progress.totalBytes * 100) : null,
      ), signal)
      const modelFileLoadMs = performance.now() - modelStartedAt
      signal.throwIfAborted()
      reportProgress('preparing', '正在准备画面', null)
      const prepareStartedAt = performance.now()
      const sourceSize = await probeDisplayResolution(filePath)
      const scale = Math.min(640 / sourceSize.width, 640 / sourceSize.height)
      const scaledWidth = Math.max(1, Math.round(sourceSize.width * scale))
      const scaledHeight = Math.max(1, Math.round(sourceSize.height * scale))
      const padX = Math.floor((640 - scaledWidth) / 2)
      const padY = Math.floor((640 - scaledHeight) / 2)
      const { stdout } = await execFileAsync(getFfmpegPath(), [
        '-v', 'error', '-i', filePath,
        '-vf', `scale=${scaledWidth}:${scaledHeight}:flags=bilinear,pad=640:640:${padX}:${padY}:color=0x727272`,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
      ], { encoding: 'buffer', maxBuffer: 640 * 640 * 3 + 1024, signal })
      const imagePrepareMs = performance.now() - prepareStartedAt
      signal.throwIfAborted()
      reportProgress('recognizing', '正在识别', null)
      const inferenceStartedAt = performance.now()
      const result = await segmentSpecializedInWorker({
        backend: 'yolo26-instances',
        modelPath: model.path,
        rgb: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
        scaledWidth,
        scaledHeight,
        padX,
        padY,
        outputSize: 512,
      }, signal)
      const inferenceMs = performance.now() - inferenceStartedAt
      signal.throwIfAborted()
      return {
        requestId,
        width: result.width,
        height: result.height,
        instanceIds: result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength),
        performance: {
          modelLoadMs: Math.round(modelFileLoadMs + result.sessionLoadMs),
          imagePrepareMs: Math.round(imagePrepareMs),
          inferenceMs: Math.round(inferenceMs),
          totalMs: Math.round(performance.now() - totalStartedAt),
        },
      }
    } finally {
      segmentationTasks.finish(task)
      finishForegroundSegmentation()
    }
  })
  ipcMain.handle('workspace:segmentImage', async (event, request: WorkspaceSegmentationRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) {
      throw new Error('自动选择任务标识无效')
    }
    if (typeof request.filePath !== 'string' || request.filePath.length === 0) throw new Error('素材路径无效')
    const { requestId, filePath, point } = request
    const isVideoInput = VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    const frameTime = isVideoInput && request.frameTime !== undefined ? Number(request.frameTime) : undefined
    if (frameTime !== undefined && (!Number.isFinite(frameTime) || frameTime < 0)) throw new Error('视频帧时间无效')
    const target = request.targetId ? automaticSegmentationTarget(request.targetId) : undefined
    if (request.targetId && !target) throw new Error('自动选择类型无效')
    const targetClassId = target?.classId ?? request.targetClassId
    const modelId = modelForSegmentationRequest(target?.id, request.modelId)
    const finishForegroundSegmentation = beginForegroundSegmentation(modelId)
    const task = segmentationTasks.begin(event.sender.id, requestId)
    const { signal } = task.controller
    watchSender(event.sender)
    let lastProgressLogKey = ''
    const reportProgress = (phase: 'model' | 'preparing' | 'recognizing', label: string, percent: number | null): void => {
      if (!segmentationTasks.isActive(task) || event.sender.isDestroyed()) return
      const progressLogKey = `${phase}:${label}:${percent === null ? 'pending' : Math.floor(percent / 10)}`
      if (progressLogKey !== lastProgressLogKey) {
        lastProgressLogKey = progressLogKey
        logMainInfo('[Mask] 自动选择进度', { requestId, targetId: target?.id, modelId, phase, label, percent })
      }
      try {
        event.sender.send('workspace:segmentation-progress', { requestId, phase, label, percent })
      } catch {
        segmentationTasks.cancel(event.sender.id, requestId)
      }
    }
    try {
    const totalStartedAt = performance.now()
    const modelStartedAt = performance.now()
    const isSam = isSamSegmentationModel(modelId)
    const specializedDefinition = SPECIALIZED_SEGMENTATION_MODELS.find((item) => item.id === modelId)
    logMainInfo('[Mask] 自动选择开始', {
      requestId,
      targetId: target?.id,
      modelId,
      fileName: path.basename(filePath),
      frameTime,
    })
    if (isSam) logMainInfo('[SAM] 智能选择开始')
    reportProgress('model', '正在准备模型', null)
    const model = isSam
      ? await loadSamModel(modelId, (progress) => reportProgress(
        'model',
        progress.completedBytes === progress.totalBytes ? '正在校验模型' : '正在下载模型',
        Math.round(progress.completedBytes / progress.totalBytes * 100),
      ), signal)
      : await loadModel(modelId as ModelId, (progress) => {
        const ratio = progress.totalBytes > 0 ? progress.completedBytes / progress.totalBytes : 0
        reportProgress(
          'model',
          progress.completedBytes === progress.totalBytes ? '正在校验模型' : '正在下载模型',
          Math.round(ratio * 100),
        )
      }, signal)
    signal.throwIfAborted()
    const modelFileLoadMs = performance.now() - modelStartedAt
    if (isSam) logMainInfo('[SAM] 模型准备完成', { modelLoadMs: Math.round(modelFileLoadMs) })
    reportProgress('preparing', '正在准备画面', null)
    const decodeStartedAt = performance.now()
    const semanticDefinition = isSam || specializedDefinition ? null : SEGMENTATION_MODELS.find((item) => item.id === modelId)
    const semanticInputSize = semanticDefinition?.inputSize ?? 512
    const sourceSize = await probeDisplayResolution(filePath)
    const samScale = sourceSize ? Math.min(1, 1024 / Math.max(sourceSize.width, sourceSize.height)) : 1
    const samWidth = sourceSize ? Math.max(1, Math.round(sourceSize.width * samScale)) : 512
    const samHeight = sourceSize ? Math.max(1, Math.round(sourceSize.height * samScale)) : 512
    const yoloScale = specializedDefinition?.backend === 'yolo26-seg' && sourceSize
      ? Math.min(640 / sourceSize.width, 640 / sourceSize.height)
      : 1
    const yoloWidth = Math.max(1, Math.round((sourceSize?.width ?? 640) * yoloScale))
    const yoloHeight = Math.max(1, Math.round((sourceSize?.height ?? 640) * yoloScale))
    const yoloPadX = Math.floor((640 - yoloWidth) / 2)
    const yoloPadY = Math.floor((640 - yoloHeight) / 2)
    const filter = isSam
      ? `scale=${samWidth}:${samHeight}:flags=bilinear,pad=1024:1024:0:0:color=black`
      : specializedDefinition?.backend === 'yolo26-seg'
        ? `scale=${yoloWidth}:${yoloHeight}:flags=bilinear,pad=640:640:${yoloPadX}:${yoloPadY}:color=0x727272`
        : specializedDefinition
          ? `scale=${specializedDefinition.inputSize}:${specializedDefinition.inputSize}:flags=bilinear`
          : `scale=${semanticInputSize}:${semanticInputSize}:flags=bilinear`
    const semanticGuidePromise = semanticDefinition
      ? prepareSemanticRefinementGuide(filePath, sourceSize, frameTime, signal)
      : Promise.resolve(null)
    const [{ stdout }, semanticGuide] = await Promise.all([
      execFileAsync(getFfmpegPath(), [
        '-v', 'error',
        ...(frameTime !== undefined ? ['-ss', String(frameTime)] : []),
        '-i', filePath,
        '-vf', filter,
        '-frames:v', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        'pipe:1',
      ], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 3 + 1024, signal }),
      semanticGuidePromise,
    ])
    signal.throwIfAborted()
    const imagePrepareMs = performance.now() - decodeStartedAt
    const inferenceStartedAt = performance.now()
    reportProgress('recognizing', '正在识别', null)
    signal.throwIfAborted()
    const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
    if (isSam) logMainInfo('[SAM] 开始原生识别', { width: samWidth, height: samHeight, bytes: rgb.byteLength })
    const result = specializedDefinition && 'path' in model
      ? await segmentSpecializedInWorker({
        backend: specializedDefinition.backend,
        modelPath: model.path,
        rgb,
        scaledWidth: specializedDefinition.backend === 'yolo26-seg' ? yoloWidth : specializedDefinition.inputSize,
        scaledHeight: specializedDefinition.backend === 'yolo26-seg' ? yoloHeight : specializedDefinition.inputSize,
        padX: specializedDefinition.backend === 'yolo26-seg' ? yoloPadX : 0,
        padY: specializedDefinition.backend === 'yolo26-seg' ? yoloPadY : 0,
        outputSize: 512,
      }, signal)
      : 'visionEncoderPath' in model
      ? await segmentSamInWorker({
        visionEncoderPath: model.visionEncoderPath,
        promptDecoderPath: model.promptDecoderPath,
        rgb,
        sourceWidth: samWidth,
        sourceHeight: samHeight,
        pointX: point?.x ?? 0.5,
        pointY: point?.y ?? 0.5,
      }, signal)
      : await segmentSemanticInWorker({
        modelPath: model.path,
        rgb,
        pointX: point?.x ?? 0.5,
        pointY: point?.y ?? 0.5,
        targetClassId,
        inputSize: semanticInputSize,
        guide: semanticGuide ?? undefined,
      }, signal)
    signal.throwIfAborted()
    const inferenceMs = performance.now() - inferenceStartedAt
    const specializedMetrics = specializedDefinition && 'sessionLoadMs' in result
      ? result as typeof result & {
        sessionLoadMs: number
        sessionReused: boolean
        workerInferenceMs: number
        executionBackend: 'onnx-cpu'
      }
      : null
    const sessionLoadMs = specializedMetrics?.sessionLoadMs ?? 0
    const modelLoadMs = modelFileLoadMs + sessionLoadMs
    if (specializedDefinition && specializedMetrics) {
      logMainInfo('[Mask] 专用模型识别完成', {
        backend: specializedDefinition.backend,
        sessionReused: specializedMetrics.sessionReused,
        sessionLoadMs,
        workerInferenceMs: specializedMetrics.workerInferenceMs,
        executionBackend: specializedMetrics.executionBackend,
      })
    }
    if (isSam) logMainInfo('[SAM] 原生识别完成', { inferenceMs: Math.round(inferenceMs) })
    const classId = 'classId' in result && typeof result.classId === 'number' ? result.classId : -1
    const classNames: Record<number, string> = {
      2: '天空',
      1: '建筑',
      4: '树木',
      9: '草地',
      12: '人物',
      16: '山体',
      17: '植物',
      20: '车辆',
      21: '水面',
      22: '海洋',
      24: '水面',
      26: '海面',
      60: '河流',
      109: '泳池',
      128: '湖面',
    }
    const reportedClassId = targetClassId ?? classId
    const className = target?.label ?? (targetClassId !== undefined
      ? classNames[targetClassId] ?? '选中区域'
      : classNames[classId] ?? '选中区域')
    const response = {
      requestId,
      width: result.width,
      height: result.height,
      classId: reportedClassId,
      className: isSam ? '已选对象' : className,
      targetId: target?.id,
      modelId: model.id,
      performance: {
        modelLoadMs: Math.round(modelLoadMs),
        imagePrepareMs: Math.round(imagePrepareMs),
        inferenceMs: Math.round(inferenceMs),
        totalMs: Math.round(performance.now() - totalStartedAt),
      },
      bytes: result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength),
    }
    logMainInfo('[Mask] 自动选择成功', {
      requestId,
      targetId: target?.id,
      modelId: model.id,
      totalMs: response.performance.totalMs,
      selectedBytes: result.bytes.byteLength,
    })
    return response
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (signal.aborted) logMainWarn('[Mask] 自动选择已取消', { requestId, targetId: target?.id, modelId, reason })
      else logMainError('[Mask] 自动选择失败', { requestId, targetId: target?.id, modelId, reason })
      throw error
    } finally {
      segmentationTasks.finish(task)
      finishForegroundSegmentation()
    }
  })
  ipcMain.handle('workspace:listProjects', async () => {
    const settings = await getSettings()
    return listWorkspaceProjects(settings.baseDir)
  })
  ipcMain.handle('workspace:createProject', async (_event, name: string, assets: WorkspaceMediaAsset[]) => {
    const settings = await getSettings()
    return createWorkspaceProject(settings.baseDir, name, assets)
  })
  ipcMain.handle('workspace:addAssetsToProject', async (_event, projectId: string, assets: WorkspaceMediaAsset[]) => {
    const settings = await getSettings()
    return addAssetsToWorkspaceProject(settings.baseDir, projectId, assets)
  })

  ipcMain.handle('workspace:saveProject', async (_event, project: WorkspaceProject) => {
    const settings = await getSettings()
    return saveWorkspaceProject(settings.baseDir, project)
  })

  ipcMain.handle('workspace:deleteProject', async (_event, projectId: string) => {
    const settings = await getSettings()
    return deleteWorkspaceProject(settings.baseDir, projectId)
  })

  ipcMain.handle('workspace:renameProject', async (_event, projectId: string, newName: string) => {
    const settings = await getSettings()
    return renameWorkspaceProject(settings.baseDir, projectId, newName)
  })

  ipcMain.handle('workspace:copyFile', async (_event, sourcePath: string) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })
    const baseName = path.basename(sourcePath)
    const ext = path.extname(baseName).toLowerCase()
    const nameBase = path.basename(baseName, ext) || 'workspace'
    const fileName = safeName(`${nameBase}_workspace_${Date.now()}${ext}`)
    const destinationPath = path.join(settings.exportDir, fileName)
    await cp(sourcePath, destinationPath, { force: true })

    const kind = VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image'
    const taskName = `${nameBase}导出`
    const exportId = `workspace_${nameBase}_${Date.now()}`
    const task = await createExportTask(taskName, [{ exportId, fileName, kind }])
    await updateTaskItemProgress(task.id, exportId, 100, 'done')

    return { path: destinationPath, name: fileName }
  })

  ipcMain.handle('workspace:readPreviewImage', async (_event, filePath: string) => {
    const data = await readFile(filePath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  })

  ipcMain.handle('workspace:extractVideoFrame', async (_event, videoPath: string, outputPath: string, frameTime: number) => {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await execFileAsync(getFfmpegPath(), [
      '-y',
      '-ss', String(Math.max(0, frameTime)),
      '-i', videoPath,
      '-frames:v', '1',
      '-c:v', 'mjpeg',
      '-pix_fmt', 'yuvj420p',
      '-q:v', '2',
      outputPath,
    ], { timeout: 30000 })
    return { path: outputPath, name: path.basename(outputPath) }
  })

  ipcMain.handle('workspace:exportRenderedLivePhoto', async (_event, name: string, imagePath: string, videoPath: string, appleLivePhoto: boolean, preserveInputs = false, recordTask = true, coverTimeSeconds?: number) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })

    if (appleLivePhoto && process.platform !== 'darwin') {
      throw new Error('Apple Live 图仅支持在 Mac 上导出')
    }

    const baseName = safeName(path.basename(name, path.extname(name)) || 'preview-live')
    const destinationPath = appleLivePhoto
      ? undefined  // Apple Live 不产出合成 .jpg，JPG+MOV 对在 appleFolder
      : path.join(settings.exportDir, `${baseName}_${Date.now()}.jpg`)
    const appleFolder = appleLivePhoto ? path.join(settings.exportDir, `${baseName}_apple_${Date.now()}`) : undefined
    let workingImagePath = imagePath
    let workingVideoPath = videoPath
    if (preserveInputs) {
      const workingStamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      workingImagePath = path.join(settings.exportDir, `.${baseName}_${workingStamp}.jpg`)
      workingVideoPath = path.join(settings.exportDir, `.${baseName}_${workingStamp}${path.extname(videoPath) || '.mp4'}`)
    }
    try {
      if (preserveInputs) {
        await Promise.all([
          cp(imagePath, workingImagePath, { force: true }),
          cp(videoPath, workingVideoPath, { force: true }),
        ])
      }
      await combineLivePhoto(workingImagePath, workingVideoPath, destinationPath ?? '', appleFolder, coverTimeSeconds)
    } finally {
      await rm(workingImagePath, { force: true }).catch(() => undefined)
      await rm(workingVideoPath, { force: true }).catch(() => undefined)
    }

    // Apple Live: 返回 appleFolder 中的 JPG 路径
    const resultPath = appleLivePhoto && appleFolder
      ? path.join(appleFolder, `${baseName}.jpg`)
      : destinationPath!
    if (recordTask) {
      const exportId = `preview_live_${baseName}_${Date.now()}`
      const taskName = appleLivePhoto ? 'Apple Live 图导出' : 'Live 图片导出'
      const task = await createExportTask(taskName, [{ exportId, fileName: path.basename(resultPath), kind: 'image' }])
      await updateTaskItemProgress(task.id, exportId, 100, 'done')
    }

    return { path: resultPath, name: path.basename(resultPath) }
  })

  // ── 调色预设 ──
  ipcMain.handle('workspace:listColorPresets', async () => {
    const settings = await getSettings()
    return listColorPresets(settings.baseDir)
  })

  ipcMain.handle('workspace:saveColorPreset', async (_event, name: string, colorJson: string) => {
    const settings = await getSettings()
    return saveColorPreset(settings.baseDir, name, colorJson)
  })

  ipcMain.handle('workspace:deleteColorPreset', async (_event, id: string) => {
    const settings = await getSettings()
    return deleteColorPreset(settings.baseDir, id)
  })

  ipcMain.handle('workspace:renameColorPreset', async (_event, id: string, newName: string) => {
    const settings = await getSettings()
    return renameColorPreset(settings.baseDir, id, newName)
  })
}
