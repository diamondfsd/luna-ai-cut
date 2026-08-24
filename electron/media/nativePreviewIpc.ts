import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'

import { getFfmpegPath, getFfprobePath } from '../platform/ffmpeg/pipeline'
import {
  cleanNativeInput,
  getNative,
  warmupRenderCore,
  type CompositionInput,
  type NativePreviewBounds,
} from '../platform/render/lunaRenderCore'
import { logMainError } from '../infrastructure/loggerService'

interface NativePreviewIpcContext {
  readonly win: BrowserWindow | null
}

type RuntimePathResolver = <T>(value: T) => Promise<T>

function safe<Args extends unknown[], Result>(
  label: string,
  handler: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      logMainError('[原生预览] 调用失败', {
        label,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

export function registerNativePreviewIpc(
  ctx: NativePreviewIpcContext,
  resolveRuntimePaths: RuntimePathResolver,
): void {
  let activeSessionId: number | null = null
  let lifecycleQueue = Promise.resolve()
  const enqueueLifecycle = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = lifecycleQueue.then(operation, operation)
    lifecycleQueue = result.then(() => undefined, () => undefined)
    return result
  }
  const destroyActiveSession = (): Promise<void> => enqueueLifecycle(async () => {
    const sessionId = activeSessionId
    activeSessionId = null
    if (sessionId !== null) await getNative().destroyNativePreviewSession(sessionId)
  })

  ctx.win?.once('closed', () => {
    void destroyActiveSession().catch((error: unknown) => {
      logMainError('[原生预览] 关闭会话失败', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })

  ipcMain.handle('lrc:createNativePreviewSession', safe('createNativePreviewSession',
    async (
      _event: IpcMainInvokeEvent,
      composition: CompositionInput,
      bounds: NativePreviewBounds,
    ) => enqueueLifecycle(async () => {
      const native = getNative()
      const previousSessionId = activeSessionId
      activeSessionId = null
      if (previousSessionId !== null) {
        await native.destroyNativePreviewSession(previousSessionId)
      }
      const win = ctx.win
      if (!win || win.isDestroyed()) throw new Error('预览窗口不可用')
      await warmupRenderCore()
      const appRoot = process.resourcesPath || process.env.APP_ROOT || join(import.meta.dirname, '..')
      const resolvedComposition = await resolveRuntimePaths(composition)
      const sessionId = await native.createNativePreviewSession({
        windowHandle: win.getNativeWindowHandle(),
        bounds,
        ffmpegPath: getFfmpegPath(),
        ffprobePath: getFfprobePath(),
        composition: cleanNativeInput(resolvedComposition),
        logPath: join(appRoot, 'luna-render-core', 'luna-rc.log'),
      })
      activeSessionId = sessionId
      return sessionId
    }),
  ))

  ipcMain.handle('lrc:updateNativePreviewComposition', safe('updateNativePreviewComposition',
    async (
      _event: IpcMainInvokeEvent,
      sessionId: number,
      composition: CompositionInput,
    ) => {
      return getNative().updateNativePreviewComposition(
        sessionId,
        cleanNativeInput(await resolveRuntimePaths(composition)),
      )
    },
  ))

  ipcMain.handle('lrc:setNativePreviewBounds', safe('setNativePreviewBounds',
    async (
      _event: IpcMainInvokeEvent,
      sessionId: number,
      bounds: NativePreviewBounds,
    ) => {
      return getNative().setNativePreviewBounds(sessionId, bounds)
    },
  ))

  ipcMain.handle('lrc:setNativePreviewVisible', safe('setNativePreviewVisible',
    async (_event: IpcMainInvokeEvent, sessionId: number, visible: boolean) => {
      return getNative().setNativePreviewVisible(sessionId, visible)
    },
  ))

  ipcMain.handle('lrc:playNativePreview', safe('playNativePreview',
    async (_event: IpcMainInvokeEvent, sessionId: number, time: number) => {
      return getNative().playNativePreview(sessionId, time)
    },
  ))

  ipcMain.handle('lrc:pauseNativePreview', safe('pauseNativePreview',
    async (_event: IpcMainInvokeEvent, sessionId: number, time: number) => {
      return getNative().pauseNativePreview(sessionId, time)
    },
  ))

  ipcMain.handle('lrc:seekNativePreview', safe('seekNativePreview',
    async (_event: IpcMainInvokeEvent, sessionId: number, time: number) => {
      return getNative().seekNativePreview(sessionId, time)
    },
  ))

  ipcMain.handle('lrc:getNativePreviewSessionStats', safe('getNativePreviewSessionStats',
    async (_event: IpcMainInvokeEvent, sessionId: number) => {
      return getNative().getNativePreviewSessionStats(sessionId)
    },
  ))

  ipcMain.handle('lrc:destroyNativePreviewSession', safe('destroyNativePreviewSession',
    async (_event: IpcMainInvokeEvent, sessionId: number) => enqueueLifecycle(async () => {
      await getNative().destroyNativePreviewSession(sessionId)
      if (activeSessionId === sessionId) activeSessionId = null
    }),
  ))
}
