import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createExportTask, getExportTaskById, updateTaskItemProgress, addTaskItem } from './exportTaskService'
import { getSettings } from './fileService'
import { safeName } from './filePathUtils'
import { FfmpegPipeline, getFfmpegPath } from './ffmpeg/pipeline'
import { detectHardwareAccel } from './ffmpeg/hwaccel'
import { CodecModule } from './ffmpeg/codec'
import { BitrateModule } from './ffmpeg/bitrate'
import { FullPipelineModule } from './ffmpeg/pipelineCompiler'
import { bakeColorLut } from './ffmpeg/lutGenerator'
import { logMainError, logMainInfo, logMainWarn } from './loggerService'
import {
  combineLivePhoto,
  extractImageFromLivePhoto,
  extractLivePhotoVideo,
  isGoogleMotionPhoto,
  watermarkFileFor,
} from './watermarkService'
import type { IpcContext } from './ipcContext'

interface WorkspaceExportMeta {
  exportId: string
  taskName: string
  taskId?: string
  fileName?: string
  index?: number
  totalFiles?: number
  createdAt?: number
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv'])

function fileSizeBytes(filePath: string): number | null {
  try {
    return statSync(filePath).size
  } catch {
    return null
  }
}

function hasColorAdjustments(pipeline: Record<string, any>): boolean {
  return Boolean(pipeline.color && Object.values(pipeline.color as Record<string, unknown>).some(
    (v) => typeof v === 'number' && v !== 0,
  ))
}

function logExportRequest(
  exportId: string,
  taskName: string,
  sourcePath: string,
  destinationPath: string,
  isVid: boolean,
  pipeline: Record<string, any>,
): void {
  logMainInfo(`[FFmpegFast] 收到导出请求`, {
    exportId, taskName, sourcePath, destinationPath, isVid,
    color: pipeline.color ? JSON.stringify({
      exposure: pipeline.color.exposure,
      brightness: pipeline.color.brightness,
      contrast: pipeline.color.contrast,
      saturation: pipeline.color.saturation,
      temperature: pipeline.color.temperature,
      tint: pipeline.color.tint,
      shadows: pipeline.color.shadows,
      highlights: pipeline.color.highlights,
      whites: pipeline.color.whites,
      blacks: pipeline.color.blacks,
      vibrance: pipeline.color.vibrance,
      clarity: pipeline.color.clarity,
      texture: pipeline.color.texture,
      sharpen: pipeline.color.sharpen,
      denoise: pipeline.color.denoise,
      gradeShadowsAmount: pipeline.color.gradeShadowsAmount,
      gradeMidAmount: pipeline.color.gradeMidAmount,
      gradeHighlightsAmount: pipeline.color.gradeHighlightsAmount,
      levelsBlack: pipeline.color.levelsBlack,
      levelsWhite: pipeline.color.levelsWhite,
      hslSat: pipeline.color.hslSat,
    }) : 'no-color',
    hasCurve: !!pipeline.color?.curve?.points,
    transform: pipeline.transform ? JSON.stringify(pipeline.transform) : 'no-transform',
    watermark: pipeline.watermark ? JSON.stringify({ enabled: pipeline.watermark.enabled, style: pipeline.watermark.style, position: pipeline.watermark.position }) : 'no-watermark',
  })
}

function addAudioPassthrough(pipeline: FfmpegPipeline): void {
  pipeline.addModule({
    name: 'audioPassthrough',
    isActive: () => true,
    build: () => ({ outputArgs: ['-map', '0:a?'] }),
  })
}

export function register(_ctx?: IpcContext): void {
  ipcMain.handle('workspace:exportFFmpeg', async (event, sourcePath: string, pipeline: Record<string, any>, exportMeta?: WorkspaceExportMeta) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })

    const baseName = path.basename(sourcePath)
    const ext = path.extname(baseName)
    const nameBase = path.basename(baseName, ext) || 'workspace'
    const isVid = VIDEO_EXTENSIONS.has(ext.toLowerCase())
    const outExt = isVid ? '.mp4' : ext
    const fileName = safeName(`${nameBase}_ffmpeg_fast_${Date.now()}${outExt}`)
    const destinationPath = path.join(settings.exportDir, fileName)
    const exportId = exportMeta?.exportId ?? `ffmpeg_fast_${nameBase}_${Date.now()}`
    const taskName = exportMeta?.taskName ?? `${nameBase}导出`

    logExportRequest(exportId, taskName, sourcePath, destinationPath, isVid, pipeline)

    const task = exportMeta?.taskId
      ? await getExportTaskById(exportMeta.taskId) ?? await createExportTask(taskName, [{ exportId, fileName, kind: isVid ? 'video' : 'image' }], exportMeta.taskId)
      : await createExportTask(taskName, [{ exportId, fileName, kind: isVid ? 'video' : 'image' }])
    if (!task) throw new Error('导出任务不存在')
    if (exportMeta?.taskId && !task.items.some((i) => i.exportId === exportId)) {
      await addTaskItem(task.id, { exportId, fileName: exportMeta.fileName ?? fileName, kind: isVid ? 'video' : 'image' })
    }

    const taskStart = Date.now()
    const win = BrowserWindow.fromWebContents(event.sender)
    let lutPath: string | undefined

    const lunaCacheDir = path.join(app.getPath('userData'), '.luna-cache')
    await mkdir(lunaCacheDir, { recursive: true })
    logMainInfo(`[FFmpegFast] 导出诊断信息`, { exportDir: settings.exportDir, lunaCacheDir })

    if (!isVid && await isGoogleMotionPhoto(sourcePath)) {
      logMainInfo('[FFmpegFast] 检测到 Live Photo，转入专用处理流程', { sourcePath, exportId, taskId: task.id })
      const liveStartedAt = Date.now()
      const liveTmpDir = path.join(lunaCacheDir, `.live_tmp_${exportId}`)
      await mkdir(liveTmpDir, { recursive: true })
      const appleExportFolder = process.platform === 'darwin' && settings.exportAppleLivePhoto
        ? path.join(liveTmpDir, `${nameBase}_apple_pair_${Date.now()}`)
        : undefined

      const sendProgress = (pct: number): void => {
        win?.webContents.send('export:progress', {
          exportId, percent: pct,
          status: pct >= 100 ? 'done' : 'exporting' as const,
          fileName: exportMeta?.fileName ?? fileName,
          taskId: task.id, taskName,
          createdAt: exportMeta?.createdAt,
          index: exportMeta?.index ?? 0,
          totalFiles: exportMeta?.totalFiles ?? 1,
        })
        void updateTaskItemProgress(task.id, exportId, taskStart, pct, pct >= 100 ? 'done' : 'exporting', { destinationPath })
      }

      try {
        const extractedImage = path.join(liveTmpDir, 'image.jpg')
        const extractedVideo = path.join(liveTmpDir, 'video.mp4')
        const processedImage = path.join(liveTmpDir, 'processed.jpg')
        const processedVideo = path.join(liveTmpDir, 'processed.mp4')
        await extractImageFromLivePhoto(sourcePath, extractedImage)
        await extractLivePhotoVideo(sourcePath, extractedVideo)
        logMainInfo('[FFmpegFast/Live] 提取完成', { exportId, elapsedMs: Date.now() - liveStartedAt })
        sendProgress(2)

        const imageStageStartedAt = Date.now()
        const imgPipeline = new FfmpegPipeline()
        let imgWatermarkPath: string | undefined
        if (pipeline.watermark?.enabled && pipeline.watermark?.style) {
          try {
            imgWatermarkPath = watermarkFileFor('image', pipeline.watermark.style)
          } catch (wmErr) {
            logMainWarn(`[FFmpegFast/Live] 图片水印解析失败，跳过`, { error: wmErr instanceof Error ? wmErr.message : String(wmErr) })
          }
        }
        let imgLutPath: string | undefined
        const hasColor = hasColorAdjustments(pipeline)
        if (hasColor) {
          try {
            imgLutPath = path.join(liveTmpDir, `.lut_img_${exportId}.cube`)
            await bakeColorLut(pipeline.color ?? {}, imgLutPath)
          } catch { imgLutPath = undefined }
        }
        imgPipeline.addModule(new FullPipelineModule(pipeline, imgWatermarkPath, imgLutPath))
        await imgPipeline.execute(extractedImage, processedImage, (percent) => {
          sendProgress(Math.round(percent * 0.38) + 2)
        })
        if (imgLutPath) await rm(imgLutPath, { force: true }).catch(() => {})
        logMainInfo('[FFmpegFast/Live] 图片阶段完成', { exportId, elapsedMs: Date.now() - imageStageStartedAt })
        sendProgress(40)

        const videoStageStartedAt = Date.now()
        const vidHwaccel = await detectHardwareAccel(getFfmpegPath())
        logMainInfo('[FFmpegFast/Live] 视频硬件加速配置', {
          exportId,
          type: vidHwaccel.type,
          preInputArgs: vidHwaccel.preInputArgs,
          encoderNameH264: vidHwaccel.encoderNameH264,
          encoderNameH265: vidHwaccel.encoderNameH265,
          encoderArgs: vidHwaccel.encoderArgs,
        })
        const vidPipeline = new FfmpegPipeline()
        if (vidHwaccel.preInputArgs.length > 0) {
          vidPipeline.setPreInputArgs(vidHwaccel.preInputArgs)
        }
        let vidWatermarkPath: string | undefined
        if (pipeline.watermark?.enabled && pipeline.watermark?.style) {
          try {
            vidWatermarkPath = watermarkFileFor('video', pipeline.watermark.style)
          } catch (wmErr) {
            logMainWarn(`[FFmpegFast/Live] 视频水印解析失败，跳过`, { error: wmErr instanceof Error ? wmErr.message : String(wmErr) })
          }
        }
        let vidLutPath: string | undefined
        if (hasColor) {
          try {
            vidLutPath = path.join(liveTmpDir, `.lut_vid_${exportId}.cube`)
            await bakeColorLut(pipeline.color ?? {}, vidLutPath)
          } catch { vidLutPath = undefined }
        }
        vidPipeline.addModule(new FullPipelineModule(pipeline, vidWatermarkPath, vidLutPath))
        vidPipeline.addModule(new BitrateModule({ quality: 'original', useSourceBitrate: true }))
        vidPipeline.addModule(new CodecModule({
          encoderH264: vidHwaccel.encoderNameH264,
          encoderH265: vidHwaccel.encoderNameH265 ?? undefined,
          encoderArgs: vidHwaccel.encoderArgs,
        }))
        addAudioPassthrough(vidPipeline)
        await vidPipeline.execute(extractedVideo, processedVideo, (percent) => {
          sendProgress(Math.round(percent * 0.4) + 40)
        })
        if (vidLutPath) await rm(vidLutPath, { force: true }).catch(() => {})
        logMainInfo('[FFmpegFast/Live] 视频阶段完成', { exportId, elapsedMs: Date.now() - videoStageStartedAt })
        sendProgress(80)

        const combineStageStartedAt = Date.now()
        await combineLivePhoto(processedImage, processedVideo, destinationPath, appleExportFolder, (percent) => {
          sendProgress(Math.round(percent * 0.2) + 80)
        })
        logMainInfo('[FFmpegFast/Live] 合成阶段完成', { exportId, elapsedMs: Date.now() - combineStageStartedAt })
      } finally {
        await rm(liveTmpDir, { recursive: true, force: true }).catch(() => {})
      }

      await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
        endTime: Date.now(),
        duration: Date.now() - taskStart,
        destinationPath,
      }).catch(() => {})
      logMainInfo('[FFmpegFast] Live Photo 导出完成', { exportId, destinationPath, elapsedMs: Date.now() - liveStartedAt })
      return { path: destinationPath, name: fileName }
    }

    try {
      const ffPipeline = new FfmpegPipeline()
      const hwaccel = isVid ? await detectHardwareAccel(getFfmpegPath()) : { type: null as string | null, preInputArgs: [] as string[], encoderNameH264: 'libx264', encoderNameH265: null, encoderArgs: [] as string[], overlayFilter: 'overlay' }
      if (isVid) {
        logMainInfo('[FFmpegFast] 视频硬件加速配置', {
          exportId,
          type: hwaccel.type,
          preInputArgs: hwaccel.preInputArgs,
          encoderNameH264: hwaccel.encoderNameH264,
          encoderNameH265: hwaccel.encoderNameH265,
          encoderArgs: hwaccel.encoderArgs,
        })
      }

      if (hwaccel.preInputArgs.length > 0) {
        ffPipeline.setPreInputArgs(hwaccel.preInputArgs)
      }

      let watermarkImagePath: string | undefined
      if (pipeline.watermark?.enabled && pipeline.watermark?.style) {
        try {
          watermarkImagePath = watermarkFileFor(isVid ? 'video' : 'image', pipeline.watermark.style)
          logMainInfo(`[FFmpegFast] 水印图片路径`, { watermarkImagePath, style: pipeline.watermark.style })
        } catch (wmErr) {
          logMainWarn(`[FFmpegFast] 水印图片解析失败，跳过水印`, { error: wmErr instanceof Error ? wmErr.message : String(wmErr) })
        }
      }

      const hasColor = hasColorAdjustments(pipeline)
      if (hasColor) {
        try {
          const lutFileName = `.lut_${exportId}_${Date.now()}.cube`
          lutPath = path.join(lunaCacheDir, lutFileName)
          await bakeColorLut(pipeline.color ?? {}, lutPath)
          logMainInfo(`[FFmpegFast] LUT 烘焙完成`, { lutPath })
          const lutExists = existsSync(lutPath)
          logMainInfo(`[FFmpegFast] LUT 文件状态`, {
            lutPath,
            lutExists,
            sizeBytes: lutExists ? fileSizeBytes(lutPath) : null,
          })
        } catch (lutErr) {
          logMainWarn(`[FFmpegFast] LUT 烘焙失败，回退直接滤镜模式`, { error: lutErr instanceof Error ? lutErr.message : String(lutErr) })
          lutPath = undefined
        }
      }

      logMainInfo(`[FFmpegFast] LUT 准备传入管线`, { lutPath, hasLutPath: !!lutPath })
      ffPipeline.addModule(new FullPipelineModule(pipeline, watermarkImagePath, lutPath))

      if (!isVid && ['.jpg', '.jpeg'].includes(outExt.toLowerCase())) {
        logMainInfo('[FFmpegFast] 图片 JPEG 高质量导出', { exportId, outputExt: outExt, qscale: 1 })
        ffPipeline.addModule({
          name: 'jpegQuality',
          isActive: () => true,
          build: () => ({ outputArgs: ['-q:v', '1'] }),
        })
      }

      if (isVid) {
        ffPipeline.addModule(new BitrateModule({
          quality: 'original',
          useSourceBitrate: true,
        }))
        ffPipeline.addModule(new CodecModule({
          encoderH264: hwaccel.encoderNameH264,
          encoderH265: hwaccel.encoderNameH265 ?? undefined,
          encoderArgs: hwaccel.encoderArgs,
        }))
        addAudioPassthrough(ffPipeline)
      }

      await ffPipeline.execute(sourcePath, destinationPath, (percent) => {
        const pct = Math.round(percent)
        win?.webContents.send('export:progress', {
          exportId,
          percent: pct,
          status: pct >= 100 ? 'done' : 'exporting' as const,
          fileName: exportMeta?.fileName ?? fileName,
          taskId: task.id,
          taskName,
          createdAt: exportMeta?.createdAt,
          index: exportMeta?.index ?? 0,
          totalFiles: exportMeta?.totalFiles ?? 1,
        })
        updateTaskItemProgress(task.id, exportId, taskStart, pct, pct >= 100 ? 'done' : 'exporting', {
          destinationPath,
        }).catch(() => {})
      })
    } catch (err) {
      logMainError(`[FFmpegFast] 导出失败`, { exportId, error: err instanceof Error ? err.message : String(err) })
      await updateTaskItemProgress(task.id, exportId, taskStart, 0, 'failed', {
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      throw err
    } finally {
      if (lutPath) {
        rm(lutPath, { force: true }).catch(() => {})
      }
    }

    await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
      endTime: Date.now(),
      duration: Date.now() - taskStart,
      destinationPath,
    }).catch(() => {})

    logMainInfo(`[FFmpegFast] 导出完成`, { exportId, destinationPath })
    return { path: destinationPath, name: fileName }
  })
}
