import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceMediaAsset, WorkspaceProject } from '../src/shared/types'
import { createExportTask, updateTaskItemProgress } from './exportStubs'
import { getLocalResourcesDir, getSettings } from './fileService'
import { safeName } from './filePathUtils'
import { getFfmpegPath, getFfprobePath, probeMedia } from './ffmpeg/pipeline'
import { bakeColorLutData } from './ffmpeg/lutGenerator'
import type { IpcContext } from './ipcContext'
import { logMainInfo } from './loggerService'
import { combineLivePhoto, isGoogleMotionPhoto } from './livePhotoService'
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

export function register(_ctx: IpcContext): void {
  ipcMain.handle('workspace:loadPreview', async (_event, filePath: string) => {
    return loadWorkspacePreview(filePath)
  })

  ipcMain.handle('workspace:getMediaResolution', async (_event, filePath: string) => {
    logMainInfo(`[workspace:getMediaResolution] REQUEST filePath=${filePath}`)
    // 统一使用 ffprobe（非阻塞，只读文件头），
    // 避免 nativeImage.createFromPath() 同步解码大图阻塞主进程
    try {
      const probe = await probeMedia(filePath)
      if (probe.videoWidth > 0 && probe.videoHeight > 0) {
        let w = probe.videoWidth
        let h = probe.videoHeight
        // ── 检测 EXIF 旋转，若旋转则交换宽高 ──
        try {
          const ffprobeBin = getFfprobePath()
          logMainInfo(`[workspace:getMediaResolution] exif ffprobe=${ffprobeBin}`)
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          const execFileAsync = promisify(execFile)
          const { stdout } = await execFileAsync(ffprobeBin, [
            '-v', 'quiet', '-print_format', 'json',
            '-show_frames', '-read_intervals', '%+#1', filePath,
          ])
          logMainInfo(`[workspace:getMediaResolution] exif stdout=${stdout.length > 500 ? stdout.substring(0,500)+'...' : stdout}`)
          const parsed = JSON.parse(stdout)
          const frame = parsed.frames?.find((f: any) => f.media_type === 'video')
          logMainInfo(`[workspace:getMediaResolution] exif frame=${JSON.stringify(frame?.tags)} sd=${JSON.stringify(frame?.side_data_list)}`)
          if (frame) {
            // 检查 side_data_list.displaymatrix.rotation
            const dmRotate = frame.side_data_list
              ?.map((sd: any) => sd.rotation)
              .find((r: number) => r === 90 || r === 270)
            // 检查 EXIF tags.Orientation
            const exifOrientation = String(frame.tags?.Orientation ?? '').trim()
            const exifRotate = exifOrientation === '6' ? 90 : exifOrientation === '8' ? 270 : 0
            const rotate = dmRotate ?? exifRotate ?? 0
            logMainInfo(`[workspace:getMediaResolution] exif dm=${dmRotate} ori='${exifOrientation}' er=${exifRotate} rot=${rotate}`)
            if (rotate === 90 || rotate === 270) {
              ;[w, h] = [h, w]
              logMainInfo(`[workspace:getMediaResolution] exif SWAP -> ${w}x${h}`)
            }
          }
        } catch (e: any) {
          logMainInfo(`[workspace:getMediaResolution] exif FAILED: ${e.message}`)
        }
        logMainInfo(`[workspace:getMediaResolution] ${filePath} -> ${w}x${h}`)
        return { width: w, height: h }
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

  ipcMain.handle('workspace:bakeAndGetLut', async (_event, colorParams: Record<string, any>) => {
    const lutData = bakeColorLutData(colorParams)
    return { lutBuffer: lutData.buffer as ArrayBuffer, lutSize: 33 }
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

  ipcMain.handle('workspace:exportRenderedLivePhoto', async (_event, name: string, imagePath: string, videoPath: string, appleLivePhoto: boolean) => {
    const settings = await getSettings()
    if (!settings.exportDir) throw new Error('未设置导出目录')
    await mkdir(settings.exportDir, { recursive: true })

    if (appleLivePhoto && process.platform !== 'darwin') {
      throw new Error('Apple Live 图仅支持在 Mac 上导出')
    }

    const baseName = safeName(path.basename(name, path.extname(name)) || 'preview-live')
    const destinationPath = path.join(settings.exportDir, `${baseName}_${Date.now()}.jpg`)
    const appleFolder = appleLivePhoto ? path.join(settings.exportDir, `${baseName}_apple_${Date.now()}`) : undefined
    try {
      await combineLivePhoto(imagePath, videoPath, destinationPath, appleFolder)
    } finally {
      await rm(imagePath, { force: true }).catch(() => undefined)
      await rm(videoPath, { force: true }).catch(() => undefined)
    }

    const exportId = `preview_live_${baseName}_${Date.now()}`
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
