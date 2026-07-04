import { BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceMediaAsset, WorkspaceProject } from '../src/shared/types'
import { createExportTask, updateTaskItemProgress } from './exportStubs'
import { getLocalResourcesDir, getSettings, previewCacheDir } from './fileService'
import { safeName } from './filePathUtils'
import { detectHardwareAccel } from './ffmpeg/hwaccel'
import { getFfmpegPath, probeMedia } from './ffmpeg/pipeline'
import { bakeColorLutData } from './ffmpeg/lutGenerator'
import type { IpcContext } from './ipcContext'
import { logMainDebug, logMainError, logMainInfo } from './loggerService'
import { applyColorGrading, previewColorFrame } from './videoPipelineService'
import { combineLivePhoto, isGoogleMotionPhoto } from './watermarkService'
import { exportTripleStitch, type TripleStitchExportOptions } from './creativeTripleStitchService'
import { readWorkspaceColorMetadata } from './workspaceColorMetadataService'
import {
  addAssetsToWorkspaceProject,
  createWorkspaceProject,
  deleteWorkspaceProject,
  listWorkspaceProjects,
  renameWorkspaceProject,
  saveWorkspaceProject,
} from './workspaceProjectService'
import { loadWorkspacePreview } from './workspacePreviewService'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.lrv'])

function colorOptions(color: Record<string, number>) {
  return {
    exposure: color.exposure ?? 0,
    brightness: color.brightness ?? 0,
    temperature: color.temperature ?? 0,
    tint: color.tint ?? 0,
    contrast: color.contrast ?? 0,
    saturation: color.saturation ?? 0,
    vibrance: color.vibrance ?? 0,
    shadows: color.shadows ?? 0,
    highlights: color.highlights ?? 0,
    whites: color.whites ?? 0,
    blacks: color.blacks ?? 0,
    levelsBlack: color.levelsBlack ?? 0,
    levelsWhite: color.levelsWhite ?? 1,
    clarity: color.clarity ?? 0,
    texture: color.texture ?? 0,
    sharpen: color.sharpen ?? 0,
    denoise: color.denoise ?? 0,
  }
}

export function register(ctx: IpcContext): void {
  ipcMain.handle('workspace:loadPreview', async (_event, filePath: string) => {
    return loadWorkspacePreview(filePath)
  })

  ipcMain.handle('workspace:getMediaResolution', async (_event, filePath: string) => {
    // 统一使用 ffprobe（非阻塞，只读文件头），
    // 避免 nativeImage.createFromPath() 同步解码大图阻塞主进程
    try {
      const probe = await probeMedia(filePath)
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        logMainInfo(`[workspace:getMediaResolution] ${filePath} -> ${probe.videoWidth}x${probe.videoHeight}`)
        return { width: probe.videoWidth, height: probe.videoHeight }
      }
    } catch { /* fallback below */ }

    throw new Error(`无法获取文件分辨率: ${filePath}`)
  })

  ipcMain.handle('workspace:isLivePhoto', async (_event, filePath: string) => {
    return isGoogleMotionPhoto(filePath)
  })

  ipcMain.handle('workspace:readColorMetadata', async (_event, filePath: string) => {
    return readWorkspaceColorMetadata(filePath)
  })

  ipcMain.handle('workspace:listProjects', async () => {
    const settings = await getSettings()
    return listWorkspaceProjects(getLocalResourcesDir(settings))
  })

  ipcMain.handle('workspace:createProject', async (_event, name: string, assets: WorkspaceMediaAsset[]) => {
    const settings = await getSettings()
    return createWorkspaceProject(getLocalResourcesDir(settings), name, assets)
  })

  ipcMain.handle('workspace:addAssetsToProject', async (_event, projectId: string, assets: WorkspaceMediaAsset[]) => {
    const settings = await getSettings()
    return addAssetsToWorkspaceProject(getLocalResourcesDir(settings), projectId, assets)
  })

  ipcMain.handle('workspace:saveProject', async (_event, project: WorkspaceProject) => {
    const settings = await getSettings()
    return saveWorkspaceProject(getLocalResourcesDir(settings), project)
  })

  ipcMain.handle('workspace:deleteProject', async (_event, projectId: string) => {
    const settings = await getSettings()
    return deleteWorkspaceProject(getLocalResourcesDir(settings), projectId)
  })

  ipcMain.handle('workspace:renameProject', async (_event, projectId: string, newName: string) => {
    const settings = await getSettings()
    return renameWorkspaceProject(getLocalResourcesDir(settings), projectId, newName)
  })

  ipcMain.handle('workspace:createExportTask', async (_event, taskName: string, items: Array<{ exportId: string; fileName: string; kind: string }>) => {
    return createExportTask(taskName, items)
  })

  ipcMain.handle('workspace:exportImage', async (_event, name: string, dataUrl: string) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    mkdirSync(settings.exportDir, { recursive: true })
    const match = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(dataUrl)
    if (!match) throw new Error('导出图片数据无效')
    const ext = match[1].toLowerCase() === 'jpeg' ? '.jpg' : '.png'
    const baseName = path.basename(name, path.extname(name)) || 'workspace'
    const fileName = safeName(`${baseName}_workspace_${Date.now()}${ext}`)
    const destinationPath = path.join(settings.exportDir, fileName)
    writeFileSync(destinationPath, Buffer.from(match[2], 'base64'))

    const taskName = `${baseName}导出`
    const exportId = `workspace_${baseName}_${Date.now()}`
    const task = await createExportTask(taskName, [{ exportId, fileName, kind: 'image' }])
    const taskStart = Date.now()
    await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
      endTime: Date.now(),
      duration: Date.now() - taskStart,
      destinationPath,
    })

    return { path: destinationPath, name: fileName }
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
    const taskStart = Date.now()
    await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
      endTime: Date.now(),
      duration: Date.now() - taskStart,
      destinationPath,
    })

    return { path: destinationPath, name: fileName }
  })

  ipcMain.handle('workspace:readPreviewImage', async (_event, filePath: string) => {
    const data = await readFile(filePath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  })

  ipcMain.handle('workspace:previewColor', async (_event, sourcePath: string, color: Record<string, number>, options?: { maxSize?: number; seekSeconds?: number }) => {
    logMainInfo(`[workspace:previewColor] 收到请求`, { sourcePath, colorKeys: Object.keys(color).join(','), maxSize: options?.maxSize, seekSeconds: options?.seekSeconds })
    const cacheDir = await previewCacheDir()
    const baseName = path.basename(sourcePath)
    const ext = path.extname(baseName)
    const nameBase = path.basename(baseName, ext)
    const maxSize = options?.maxSize ?? 480
    const fileName = safeName(`preview_${nameBase}_${maxSize}_${Date.now()}.jpg`)
    const outputPath = path.join(cacheDir, fileName)
    await mkdir(cacheDir, { recursive: true }).catch(() => {})

    await previewColorFrame(sourcePath, outputPath, colorOptions(color), { maxSize, seekSeconds: options?.seekSeconds })
    logMainInfo(`[workspace:previewColor] 完成`, { outputPath })

    const data = await readFile(outputPath)
    return { path: outputPath, dataUrl: `data:image/jpeg;base64,${data.toString('base64')}` }
  })

  ipcMain.handle('workspace:exportColor', async (event, sourcePath: string, color: Record<string, number>, exportMeta?: { exportId: string; taskName: string }) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })
    const baseName = path.basename(sourcePath)
    const ext = path.extname(baseName)
    const nameBase = path.basename(baseName, ext) || 'workspace'
    const fileName = safeName(`${nameBase}_workspace_${Date.now()}${ext}`)
    const destinationPath = path.join(settings.exportDir, fileName)
    const exportId = exportMeta?.exportId ?? `workspace_${nameBase}_${Date.now()}`
    const taskName = exportMeta?.taskName ?? `${nameBase}导出`

    logMainInfo(`[workspace:exportColor] 开始导出`, { exportId, taskName, sourcePath, destinationPath, hasExportMeta: !!exportMeta })

    const win = BrowserWindow.fromWebContents(event.sender)
    const taskStart = Date.now()
    const task = await createExportTask(taskName, [{ exportId, fileName, kind: 'video' }])
    logMainInfo(`[workspace:exportColor] 任务已创建`, { taskId: task.id, exportId })

    await applyColorGrading(sourcePath, destinationPath, colorOptions(color), (percent) => {
      const pct = Math.round(percent)
      logMainDebug(`[workspace:exportColor] 进度`, { exportId, percent: pct })
      win?.webContents.send('export:progress', {
        exportId,
        percent: pct,
        status: pct >= 100 ? 'done' : 'exporting',
        fileName,
        taskName,
        index: 0,
        totalFiles: 1,
      })
      updateTaskItemProgress(task.id, exportId, taskStart, pct, pct >= 100 ? 'done' : 'exporting', {
        destinationPath,
      }).catch(() => {})
    })

    logMainInfo(`[workspace:exportColor] ffmpeg 完成`)
    await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
      endTime: Date.now(),
      duration: Date.now() - taskStart,
      destinationPath,
    })

    return { path: destinationPath, name: fileName }
  })

  ipcMain.handle('workspace:bakeAndGetLut', async (_event, colorParams: Record<string, any>) => {
    const lutData = bakeColorLutData(colorParams)
    return { lutBuffer: lutData.buffer as ArrayBuffer, lutSize: 33 }
  })

  ipcMain.handle('workspace:startVideoExport', async (_event, meta: {
    exportId: string; taskName: string; outputName: string;
    width: number; height: number; fps: number;
  }) => {
    const { exportId, taskName, outputName, width, height, fps } = meta
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })
    const baseName = path.basename(outputName, path.extname(outputName)) || 'workspace'
    const fileName = safeName(`${baseName}_${taskName}_${Date.now()}.mp4`)
    const outputPath = path.join(settings.exportDir, fileName)
    const rawFilePath = outputPath.replace(/\.mp4$/, '.raw')
    logMainInfo(`[videoExport] 开始 WebGL 视频导出`, { exportId, taskName, width, height, fps, outputPath, rawFilePath })

    const task = await createExportTask(taskName, [{ exportId, fileName, kind: 'video' }])
    const taskStart = Date.now()

    return { exportId, outputPath, rawFilePath, taskId: task.id, taskStart }
  })

  const exportVideoFrameCount = new Map<string, number>()
  const exportVideoMeta = new Map<string, { totalFrames: number; taskId: string; taskStart: number; rawFilePath: string }>()
  ipcMain.handle('workspace:sendVideoExportFrame', async (_event, exportId: string, frameData: ArrayBuffer, meta?: { totalFrames: number; taskId: string; taskStart: number; rawFilePath: string }) => {
    if (meta) exportVideoMeta.set(exportId, meta)
    const exportMeta = exportVideoMeta.get(exportId)
    if (!exportMeta) return

    const count = (exportVideoFrameCount.get(exportId) ?? 0) + 1
    exportVideoFrameCount.set(exportId, count)
    await appendFile(exportMeta.rawFilePath, Buffer.from(frameData))

    if (count % 30 === 0 || count === 1) {
      const pct = Math.round((count / exportMeta.totalFrames) * 100)
      logMainInfo(`[videoExport] 任务进度 ${count}/${exportMeta.totalFrames} (${pct}%)`, { exportId })
      await updateTaskItemProgress(exportMeta.taskId, exportId, exportMeta.taskStart, pct, pct >= 100 ? 'done' : 'exporting', {}).catch(() => {})
    }
  })

  ipcMain.handle('workspace:endVideoExport', async (_event, exportId: string, meta: { taskId: string; taskStart: number; outputPath: string; rawFilePath: string; width: number; height: number; fps: number }) => {
    const { outputPath, rawFilePath, width, height, fps: fpsMeta } = meta
    logMainInfo(`[videoExport] 开始编码 temp raw 文件`, { exportId, rawFilePath, outputPath })

    const hwaccel = await detectHardwareAccel(getFfmpegPath())
    const encoder = spawn(getFfmpegPath(), [
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${width}x${height}`,
      '-r', String(fpsMeta),
      '-i', rawFilePath,
      '-c:v', hwaccel.encoderNameH264,
      '-pix_fmt', 'yuv420p',
      ...hwaccel.encoderArgs,
      '-y', outputPath,
    ])
    ctx.activeExportEncoders.set(exportId, encoder)

    return new Promise<{ path: string; name: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        encoder.kill()
        reject(new Error('视频编码超时'))
      }, 5 * 60 * 1000)

      encoder.on('close', async (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          logMainError(`[videoExport] ffmpeg 编码异常退出`, { exportId, code })
          reject(new Error(`ffmpeg 编码退出 (code=${code})`))
          return
        }
        try { await rm(rawFilePath) } catch {}

        logMainInfo(`[videoExport] 视频导出完成`, { exportId })
        exportVideoMeta.delete(exportId)
        exportVideoFrameCount.delete(exportId)
        ctx.activeExportEncoders.delete(exportId)
        resolve({ path: outputPath, name: path.basename(outputPath) })
      })

      encoder.on('error', (err) => {
        clearTimeout(timeout)
        ctx.activeExportEncoders.delete(exportId)
        reject(err)
      })
    })
  })

  // ── 创意工坊：Data URL 导出（图片/短视频） ──
  ipcMain.handle('workspace:exportCreativeDataUrl', async (_event, name: string, dataUrl: string, kind: 'image' | 'video') => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    mkdirSync(settings.exportDir, { recursive: true })

    const match = /^data:(image\/png|image\/jpeg|video\/webm);base64,(.+)$/i.exec(dataUrl)
    if (!match) throw new Error('导出内容无效')

    const mime = match[1].toLowerCase()
    const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'video/webm' ? '.webm' : '.png'
    const baseName = path.basename(name, path.extname(name)) || 'creative'
    const fileName = safeName(`${baseName}_${Date.now()}${ext}`)
    const destinationPath = path.join(settings.exportDir, fileName)
    writeFileSync(destinationPath, Buffer.from(match[2], 'base64'))

    const exportId = `creative_${baseName}_${Date.now()}`
    const taskName = kind === 'video' ? '创意短视频导出' : '创意图片导出'
    const task = await createExportTask(taskName, [{ exportId, fileName, kind }])
    const taskStart = Date.now()
    await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
      endTime: Date.now(),
      duration: Date.now() - taskStart,
      destinationPath,
    })

    return { path: destinationPath, name: fileName }
  })

  // ── 创意工坊：Live Photo 导出（WebM → MP4 + JPEG 合成） ──
  ipcMain.handle('workspace:exportCreativeLivePhoto', async (_event, name: string, imageDataUrl: string, videoDataUrl: string, appleLivePhoto: boolean) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })

    if (appleLivePhoto && process.platform !== 'darwin') {
      throw new Error('Apple Live 图仅支持在 Mac 上导出')
    }

    const imageMatch = /^data:image\/jpeg;base64,(.+)$/i.exec(imageDataUrl)
    const videoMatch = /^data:video\/webm;base64,(.+)$/i.exec(videoDataUrl)
    if (!imageMatch || !videoMatch) throw new Error('导出内容无效')

    const baseName = safeName(path.basename(name, path.extname(name)) || 'creative-live')
    const tmpDir = path.join(settings.exportDir, `.creative_live_${Date.now()}`)
    await mkdir(tmpDir, { recursive: true })
    const imagePath = path.join(tmpDir, `${baseName}.jpg`)
    const webmPath = path.join(tmpDir, `${baseName}.webm`)
    const mp4Path = path.join(tmpDir, `${baseName}.mp4`)
    const destinationPath = path.join(settings.exportDir, `${baseName}_${Date.now()}.jpg`)

    writeFileSync(imagePath, Buffer.from(imageMatch[1], 'base64'))
    writeFileSync(webmPath, Buffer.from(videoMatch[1], 'base64'))

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(getFfmpegPath(), [
        '-y',
        '-i', webmPath,
        '-t', '3',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'faststart',
        mp4Path,
      ])
      let stderr = ''
      ffmpeg.stderr.on('data', (chunk) => { stderr += String(chunk) })
      ffmpeg.on('error', reject)
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr || 'Live 图视频生成失败'))
      })
    })

    const appleFolder = appleLivePhoto ? path.join(tmpDir, `${baseName}_apple`) : undefined
    await combineLivePhoto(imagePath, mp4Path, destinationPath, appleFolder)
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)

    const exportId = `creative_live_${baseName}_${Date.now()}`
    const taskName = appleLivePhoto ? 'Apple Live 图导出' : 'Live 图片导出'
    const task = await createExportTask(taskName, [{ exportId, fileName: path.basename(destinationPath), kind: 'image' }])
    const taskStart = Date.now()
    await updateTaskItemProgress(task.id, exportId, taskStart, 100, 'done', {
      endTime: Date.now(),
      duration: Date.now() - taskStart,
      destinationPath,
    })

    return { path: destinationPath, name: path.basename(destinationPath) }
  })

  // ── 创意工坊：三联画导出 ──
  ipcMain.handle('workspace:exportTripleStitch', async (event, options: TripleStitchExportOptions) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    if (options.outputs.appleLivePhoto && process.platform !== 'darwin') {
      throw new Error('Apple Live 图仅支持在 Mac 上导出')
    }
    return exportTripleStitch(settings.exportDir, options, event.sender)
  })
}
