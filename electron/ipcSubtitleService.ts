import { app, ipcMain } from 'electron'
import type { WorkspaceSubtitleTranscriptionRequest } from '../src/shared/types'
import { transcribeVideo } from './subtitleTranscriptionService'

const tasks = new Map<string, AbortController>()

export function register(): void {
  ipcMain.handle('workspace:transcribeSubtitles', async (event, request: WorkspaceSubtitleTranscriptionRequest) => {
    if (tasks.size > 0) throw new Error('已有字幕识别任务正在进行')
    const controller = new AbortController()
    tasks.set(request.requestId, controller)
    const abort = (): void => controller.abort()
    event.sender.once('destroyed', abort)
    try {
      return await transcribeVideo(request, controller.signal, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('workspace:subtitle-progress', progress)
      })
    } finally {
      event.sender.removeListener('destroyed', abort)
      tasks.delete(request.requestId)
    }
  })

  ipcMain.handle('workspace:cancelSubtitleTranscription', (_event, requestId: string) => {
    tasks.get(requestId)?.abort()
  })

  app.once('before-quit', () => {
    for (const controller of tasks.values()) controller.abort()
  })
}
