/**
 * IPC 处理器 — 统一导出（Worker 线程运行，不卡主进程）
 */
import { ipcMain } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { ExportInput, ExportState, ExportStatus } from './lunaExportService'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { watermarkFileFor } from './watermarkAssets'
import { getExportTasks, clearExportTasks, createExportTask, updateTaskItemProgress } from './exportStubs'

interface RegisterContext { win: Electron.BrowserWindow | null }

const taskMap = new Map<string, { taskId: string }>()
const activeExports = new Map<string, AbortController>()

async function syncTask(state: ExportState) {
  let entry = taskMap.get(state.id)
  if (!entry) {
    const task = await createExportTask(state.fileName + '导出', [{ exportId: state.id, fileName: state.fileName, kind: 'image' }])
    entry = { taskId: task.id }; taskMap.set(state.id, entry)
  }
  const ms = (s: ExportStatus): 'queued' | 'exporting' | 'done' | 'failed' | 'canceled' =>
    s === 'downloading' || s === 'rendering' ? 'exporting' : s === 'queued' || s === 'done' || s === 'failed' || s === 'canceled' ? s : 'exporting'
  await updateTaskItemProgress(entry.taskId, state.id, Date.now(), state.progress, ms(state.status), {
    destinationPath: state.outputPath, error: state.error,
  })
}

function sendProgress(ctx: RegisterContext, state: ExportState) {
  if (!ctx.win || ctx.win.isDestroyed()) return
  syncTask(state).catch(() => {})
  ctx.win.webContents.send('export:progress', {
    exportId: state.id, fileName: state.fileName, index: 0, totalFiles: 1,
    percent: state.status === 'done' || state.status === 'failed' ? 100 : state.progress,
    status: state.status === 'queued' ? 'queued' :
            state.status === 'downloading' || state.status === 'rendering' ? 'exporting' :
            state.status === 'done' ? 'done' : state.status === 'failed' ? 'failed' : 'canceled',
    destinationPath: state.outputPath, error: state.error,
  })
}

export function register(ctx: RegisterContext): void {
  ipcMain.handle('exports:getTasks', async () => getExportTasks())
  ipcMain.handle('exports:clearTasks', async () => { clearExportTasks() })

  ipcMain.on('luna-export:start', (_event, input: ExportInput) => {
    input.ffmpegPath = getFfmpegPath()
    input.ffprobePath = getFfprobePath()
    input.logPath = join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'luna-render-core', 'luna-rc.log')
    if (input.watermark?.enabled && input.watermark.style) {
      try { input.watermark.overlayPath = watermarkFileFor(input.kind === 'video' ? 'video' : 'image', input.watermark.style) } catch {}
    }

    const fname = input.outputName || input.localPath?.split('/').pop() || ''
    sendProgress(ctx, { id: input.id, fileName: fname, status: 'queued', progress: 0 })

    const ctrl = new AbortController()
    activeExports.set(input.id, ctrl)

    const wp = join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'dist-electron', 'luna-exportWorker.js')
    const worker = new Worker(wp)

    worker.on('message', (msg: any) => {
      if (msg.type === 'progress') sendProgress(ctx, msg.state)
      else if (msg.type === 'done') { sendProgress(ctx, msg.state); worker.terminate(); activeExports.delete(input.id) }
      else if (msg.type === 'error') { sendProgress(ctx, { id: input.id, fileName: fname, status: 'failed', progress: 100, error: msg.error }); worker.terminate(); activeExports.delete(input.id) }
    })
    worker.on('error', (err: Error) => { sendProgress(ctx, { id: input.id, fileName: fname, status: 'failed', progress: 100, error: err.message }); activeExports.delete(input.id) })
    worker.on('exit', () => { activeExports.delete(input.id) })
    worker.postMessage({ type: 'start', input })
  })

  ipcMain.on('luna-export:cancel', (_event, exportId: string) => {
    activeExports.get(exportId)?.abort(); activeExports.delete(exportId)
  })
}
