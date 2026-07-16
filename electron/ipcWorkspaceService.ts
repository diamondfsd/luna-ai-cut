import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import fs from 'node:fs'
import { promisify } from 'node:util'
import type { WorkspaceMediaAsset, WorkspaceProject, WorkspaceSegmentationRequest } from '../src/shared/types'
import { createExportTask, updateTaskItemProgress } from './exportStubs'
import probe from 'probe-image-size'
import { getSettings } from './fileService'
import { safeName } from './filePathUtils'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { logMainError, logMainInfo } from './loggerService'
import { combineLivePhoto, isGoogleMotionPhoto } from './livePhotoService'
import { readWorkspaceColorMetadata } from './workspaceColorMetadataService'
import {
  addAssetsToWorkspaceProject,
  createWorkspaceProject,
  deleteWorkspaceProject,
  listWorkspaceProjects,
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
import { loadModel, loadSamModel, type ModelId } from './modelLoader'
import { isSamSegmentationModel, SEGMENTATION_MODELS, type SegmentationModelId } from '../src/shared/segmentationModels'
import { getNative } from './lunaRenderCore'
import { segmentSamInWorker } from './samSegmentationService'
import { cleanupUnreferencedColorMasks, deleteColorMask, loadColorMask, saveColorMask } from './colorMaskService'
import { SegmentationTaskRegistry } from './segmentationTaskRegistry'

const MASKFORMER_COMMON_CLASS_IDS: Record<number, number> = {
  1: 1,
  2: 2,
  4: 3,
  9: 12,
  12: 11,
  17: 16,
  20: 14,
  21: 24,
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.lrv'])
const execFileAsync = promisify(execFile)

function normalizeRotation(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numeric)) return null
  const rotation = ((Math.round(numeric) % 360) + 360) % 360
  return rotation === 90 || rotation === 270 ? rotation : null
}

function rotationFromSideData(value: any): number | null {
  const sideData = Array.isArray(value?.side_data_list) ? value.side_data_list : []
  for (const item of sideData) {
    const rotation = normalizeRotation(item?.rotation)
    if (rotation) return rotation
  }
  return null
}

function rotationFromTags(value: any): number | null {
  const orientation = String(value?.tags?.Orientation ?? value?.tags?.orientation ?? '').trim()
  if (orientation === '6') return 90
  if (orientation === '8') return 270
  return normalizeRotation(value?.tags?.rotate ?? value?.tags?.Rotate)
}

function displayRotation(frame: any, stream: any): number {
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
    const parsed = JSON.parse(stdout)
    const frame = parsed.frames?.find((f: any) => f.media_type === 'video')
    const stream = parsed.streams?.find((s: any) => s.codec_type === 'video')
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
  const watchedSenders = new Set<number>()
  const watchSender = (sender: Electron.WebContents): void => {
    if (watchedSenders.has(sender.id)) return
    watchedSenders.add(sender.id)
    const cancelSenderTasks = (): void => { segmentationTasks.cancelOwner(sender.id) }
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
    return saveColorMask(settings.downloadDir, projectId, assetId, width, height, bytes, feather)
  })

  ipcMain.handle('workspace:loadColorMask', async (_event, projectId: string, filePath: string) => {
    const settings = await getSettings()
    return loadColorMask(settings.downloadDir, projectId, filePath)
  })

  ipcMain.handle('workspace:deleteColorMask', async (_event, projectId: string, filePath: string) => {
    const settings = await getSettings()
    await deleteColorMask(settings.downloadDir, projectId, filePath)
  })

  ipcMain.handle('workspace:cleanupColorMasks', async (_event, projectId: string, retainedPaths: string[]) => {
    const settings = await getSettings()
    return cleanupUnreferencedColorMasks(settings.downloadDir, projectId, retainedPaths)
  })

  ipcMain.handle('workspace:loadPreview', async (_event, filePath: string) => {
    return loadWorkspacePreview(filePath)
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

  ipcMain.handle('workspace:isLivePhoto', async (_event, filePath: string) => {
    return isGoogleMotionPhoto(filePath)
  })

  ipcMain.handle('workspace:readColorMetadata', async (_event, filePath: string) => {
    return readWorkspaceColorMetadata(filePath)
  })

  ipcMain.handle('workspace:cancelSegmentation', (event, requestId: string) => {
    if (typeof requestId !== 'string' || requestId.length === 0) return false
    return segmentationTasks.cancel(event.sender.id, requestId)
  })
  ipcMain.handle('workspace:segmentImage', async (event, request: WorkspaceSegmentationRequest) => {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length === 0 || request.requestId.length > 128) {
      throw new Error('自动选择任务标识无效')
    }
    if (typeof request.filePath !== 'string' || request.filePath.length === 0) throw new Error('图片路径无效')
    const { requestId, filePath, point, targetClassId } = request
    const modelId: SegmentationModelId = request.modelId ?? 'segformer-b0-ade20k'
    const task = segmentationTasks.begin(event.sender.id, requestId)
    const { signal } = task.controller
    watchSender(event.sender)
    const reportProgress = (phase: 'model' | 'preparing' | 'recognizing', label: string, percent: number | null): void => {
      if (!segmentationTasks.isActive(task) || event.sender.isDestroyed()) return
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
    if (isSam) logMainInfo('[SAM] 智能选择开始')
    reportProgress('model', '正在准备模型', null)
    const model = isSam
      ? await loadSamModel(modelId, (progress) => reportProgress(
        'model',
        progress.completedBytes === progress.totalBytes ? '正在校验模型' : '正在下载模型',
        Math.round(progress.completedBytes / progress.totalBytes * 100),
      ), signal)
      : await loadModel(modelId as ModelId, (progress) => reportProgress(
        'model',
        progress.completedBytes === progress.totalBytes ? '正在校验模型' : '正在下载模型',
        Math.round(progress.completedBytes / progress.totalBytes * 100),
      ), signal)
    signal.throwIfAborted()
    const modelLoadMs = performance.now() - modelStartedAt
    if (isSam) logMainInfo('[SAM] 模型准备完成', { modelLoadMs: Math.round(modelLoadMs) })
    reportProgress('preparing', '正在准备图片', null)
    const decodeStartedAt = performance.now()
    const semanticDefinition = isSam ? null : SEGMENTATION_MODELS.find((item) => item.id === modelId)
    const semanticInputSize = semanticDefinition?.inputSize ?? 512
    const sourceSize = isSam ? await probeDisplayResolution(filePath) : null
    const samScale = sourceSize ? Math.min(1, 1024 / Math.max(sourceSize.width, sourceSize.height)) : 1
    const samWidth = sourceSize ? Math.max(1, Math.round(sourceSize.width * samScale)) : 512
    const samHeight = sourceSize ? Math.max(1, Math.round(sourceSize.height * samScale)) : 512
    const filter = isSam
      ? `scale=${samWidth}:${samHeight}:flags=bilinear,pad=1024:1024:0:0:color=black`
      : `scale=${semanticInputSize}:${semanticInputSize}:flags=bilinear`
    const { stdout } = await execFileAsync(getFfmpegPath(), [
      '-v', 'error',
      '-i', filePath,
      '-vf', filter,
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 3 + 1024, signal })
    signal.throwIfAborted()
    const imagePrepareMs = performance.now() - decodeStartedAt
    const inferenceStartedAt = performance.now()
    reportProgress('recognizing', '正在识别', null)
    signal.throwIfAborted()
    const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
    if (isSam) logMainInfo('[SAM] 开始原生识别', { width: samWidth, height: samHeight, bytes: rgb.byteLength })
    const nativeTargetClassId = modelId === 'maskformer-r101-ade20k-full' && targetClassId !== undefined
      ? MASKFORMER_COMMON_CLASS_IDS[targetClassId] ?? targetClassId
      : targetClassId
    const result = 'visionEncoderPath' in model
      ? await segmentSamInWorker({
        visionEncoderPath: model.visionEncoderPath,
        promptDecoderPath: model.promptDecoderPath,
        rgb,
        sourceWidth: samWidth,
        sourceHeight: samHeight,
        pointX: point?.x ?? 0.5,
        pointY: point?.y ?? 0.5,
      }, signal)
      : getNative().segmentImage(model.path, rgb, point?.x ?? 0.5, point?.y ?? 0.5, nativeTargetClassId, semanticInputSize)
    signal.throwIfAborted()
    const inferenceMs = performance.now() - inferenceStartedAt
    if (isSam) logMainInfo('[SAM] 原生识别完成', { inferenceMs: Math.round(inferenceMs) })
    const classId = 'classId' in result && typeof result.classId === 'number' ? result.classId : -1
    const classNames: Record<number, string> = {
      2: '天空',
      1: '建筑',
      4: '树木',
      9: '草地',
      12: '人物',
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
    const maskFormerClassNames: Record<number, string> = {
      1: '建筑',
      2: '天空',
      3: '树木',
      11: '人物',
      12: '草地',
      14: '车辆',
      16: '植物',
      22: '海洋',
      24: '水面',
      71: '瀑布',
    }
    const reportedClassId = targetClassId ?? classId
    const className = targetClassId !== undefined
      ? classNames[targetClassId] ?? '选中区域'
      : modelId === 'maskformer-r101-ade20k-full'
        ? maskFormerClassNames[classId] ?? '选中区域'
        : classNames[classId] ?? '选中区域'
    return {
      requestId,
      width: result.width,
      height: result.height,
      classId: reportedClassId,
      className: isSam ? '已选对象' : className,
      modelId: model.id,
      performance: {
        modelLoadMs: Math.round(modelLoadMs),
        imagePrepareMs: Math.round(imagePrepareMs),
        inferenceMs: Math.round(inferenceMs),
        totalMs: Math.round(performance.now() - totalStartedAt),
      },
      bytes: result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength),
    }
    } finally {
      segmentationTasks.finish(task)
    }
  })
  ipcMain.handle('workspace:listProjects', async () => {
    const settings = await getSettings()
    return listWorkspaceProjects(settings.downloadDir)
  })

  ipcMain.handle('workspace:createProject', async (_event, name: string, assets: WorkspaceMediaAsset[]) => {
    const settings = await getSettings()
    return createWorkspaceProject(settings.downloadDir, name, assets)
  })

  ipcMain.handle('workspace:addAssetsToProject', async (_event, projectId: string, assets: WorkspaceMediaAsset[]) => {
    const settings = await getSettings()
    return addAssetsToWorkspaceProject(settings.downloadDir, projectId, assets)
  })

  ipcMain.handle('workspace:saveProject', async (_event, project: WorkspaceProject) => {
    const settings = await getSettings()
    return saveWorkspaceProject(settings.downloadDir, project)
  })

  ipcMain.handle('workspace:deleteProject', async (_event, projectId: string) => {
    const settings = await getSettings()
    return deleteWorkspaceProject(settings.downloadDir, projectId)
  })

  ipcMain.handle('workspace:renameProject', async (_event, projectId: string, newName: string) => {
    const settings = await getSettings()
    return renameWorkspaceProject(settings.downloadDir, projectId, newName)
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
    return listColorPresets(settings.downloadDir)
  })

  ipcMain.handle('workspace:saveColorPreset', async (_event, name: string, colorJson: string) => {
    const settings = await getSettings()
    return saveColorPreset(settings.downloadDir, name, colorJson)
  })

  ipcMain.handle('workspace:deleteColorPreset', async (_event, id: string) => {
    const settings = await getSettings()
    return deleteColorPreset(settings.downloadDir, id)
  })

  ipcMain.handle('workspace:renameColorPreset', async (_event, id: string, newName: string) => {
    const settings = await getSettings()
    return renameColorPreset(settings.downloadDir, id, newName)
  })
}
