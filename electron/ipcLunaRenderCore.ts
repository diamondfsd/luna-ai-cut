/**
 * IPC 处理器 — Luna Render Core
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureInit,
  loadTexture as lrcLoadTexture,
  updateTexture as lrcUpdateTexture,
  releaseTexture as lrcReleaseTexture,
  renderFrame as lrcRenderFrame,
  exportFile as lrcExportFile,
  destroy as lrcDestroy,
} from './lunaRenderCore'
import { dialog } from 'electron'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'

interface RegisterContext {
  win: Electron.BrowserWindow | null
}

interface RenderLayerArg {
  textureId: number
  dstX: number; dstY: number; dstW: number; dstH: number
  srcX?: number; srcY?: number; srcW?: number; srcH?: number
  opacity?: number; zIndex?: number
}

/** 写日志到文件（追加模式），APP_ROOT 在 appMain.ts 中设置 */
function rcLog(msg: string): void {
  const appRoot = process.env.APP_ROOT || join(import.meta.dirname, '..')
  const logPath = join(appRoot, 'luna-render-core', 'luna-rc.log')
  try {
    const ts = new Date().toISOString().slice(11, 23)
    appendFileSync(logPath, `[${ts}] [main] ${msg}\n`)
  } catch { /* ignore */ }
}

/** 包装 handler：自动 catch 异常并记日志 */
function safe<T extends (...args: any[]) => any>(label: string, fn: T): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      rcLog(`ERROR in ${label}: ${msg}`)
      throw err
    }
  }) as unknown as T
}

export function register(_ctx: RegisterContext): void {
  // 打开文件选择对话框，返回文件路径
  ipcMain.handle('lrc:pickVideo', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择视频文件',
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'insv'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('lrc:init', safe('init', async (_event: IpcMainInvokeEvent, logPath?: string) => {
    ensureInit(logPath)
    rcLog('lrc:init OK')
  }))

  ipcMain.handle('lrc:loadTexture', safe('loadTexture',
    async (_event: IpcMainInvokeEvent, data: Buffer, width: number, height: number) => {
      const id = lrcLoadTexture(data, width, height)
      rcLog(`lrc:loadTexture -> id=${id} ${width}x${height}`)
      return id
    },
  ))

  ipcMain.handle('lrc:updateTexture', safe('updateTexture',
    async (_event: IpcMainInvokeEvent, textureId: number, data: Buffer) => {
      lrcUpdateTexture(textureId, data)
    },
  ))

  ipcMain.handle('lrc:releaseTexture', safe('releaseTexture',
    async (_event: IpcMainInvokeEvent, textureId: number) => {
      lrcReleaseTexture(textureId)
      rcLog(`lrc:releaseTexture id=${textureId}`)
    },
  ))

  ipcMain.handle('lrc:renderFrame', safe('renderFrame',
    async (
      _event: IpcMainInvokeEvent,
      canvasWidth: number,
      canvasHeight: number,
      layers: RenderLayerArg[],
    ) => {
      return lrcRenderFrame(canvasWidth, canvasHeight, layers)
    },
  ))

  ipcMain.handle('lrc:exportVideo', safe('exportVideo',
    async (
      _event: IpcMainInvokeEvent,
      inputPath: string,
      outputPath: string,
      canvasWidth: number,
      canvasHeight: number,
      fps: number | null,
      hardware: boolean,
      videoLayer: RenderLayerArg,
      overlayLayers: RenderLayerArg[],
    ) => {
      const ffmpegPath = getFfmpegPath()
      const ffprobePath = getFfprobePath()
      rcLog(`lrc:exportVideo f=${ffmpegPath} p=${ffprobePath} ${inputPath} → ${outputPath}`)
      lrcExportFile(ffmpegPath, ffprobePath, inputPath, outputPath, canvasWidth, canvasHeight, fps, hardware, videoLayer, overlayLayers)
      rcLog('lrc:exportVideo done')
    },
  ))

  ipcMain.handle('lrc:destroy', async () => {
    lrcDestroy()
  })
}
