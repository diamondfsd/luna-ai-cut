/**
 * IPC 处理器 — 统一导出服务（Worker Thread 版本）
 *
 * 导出在独立线程中执行，避免阻塞 Electron 主进程。
 */
import { ipcMain } from 'electron'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { ExportInput, ExportState } from './lunaExportService'
import { getFfmpegPath, getFfprobePath } from './ffmpeg/pipeline'
import { getExportTasks, clearExportTasks } from './exportStubs'

interface RegisterContext {
  win: Electron.BrowserWindow | null
}

function sendProgress(ctx: RegisterContext, state: ExportState) {
  if (!ctx.win || ctx.win.isDestroyed()) return
  // 统一导出进度
  ctx.win.webContents.send('luna-export:progress', state)
  // 桥接到现有 ExportProgressModal
  ctx.win.webContents.send('export:progress', {
    exportId: state.id,
    fileName: state.fileName,
    percent: state.status === 'done' || state.status === 'failed' ? 100 : state.progress,
    status: state.status === 'queued' ? 'queued' :
            state.status === 'downloading' || state.status === 'rendering' ? 'exporting' :
            state.status === 'done' ? 'done' :
            state.status === 'failed' ? 'failed' :
            state.status === 'canceled' ? 'canceled' : 'exporting',
    destinationPath: state.outputPath,
    error: state.error,
    index: 0, totalFiles: 1,
  })
}

// 活跃的 Worker
const activeWorkers = new Map<string, Worker>()

function getWorkerPath(): string {
  // 编译后在 dist-electron/ 下
  if (process.env.APP_ROOT) return join(process.env.APP_ROOT, 'dist-electron', 'luna-exportWorker.js')
  // 开发模式
  const root = process.env.APP_ROOT || join(import.meta.dirname, '..')
  return join(root, 'dist-electron', 'luna-exportWorker.js')
}

export function register(ctx: RegisterContext): void {
  // 旧导出查询兼容（ExportProgressModal 弹窗需要）
  ipcMain.handle('exports:getTasks', async () => getExportTasks())
  ipcMain.handle('exports:clearTasks', async () => { clearExportTasks() })

  ipcMain.on('luna-export:start', (_event, input: ExportInput) => {
    const existing = activeWorkers.get(input.id)
    if (existing) {
      existing.postMessage({ type: 'cancel', id: input.id })
      existing.terminate()
    }

    // 解析 FFmpeg 路径（Worker 不能 import electron）
    input.ffmpegPath = getFfmpegPath()
    input.ffprobePath = getFfprobePath()
    input.logPath = join(process.env.APP_ROOT || join(import.meta.dirname, '..'), 'luna-render-core', 'luna-rc.log')

    // 先发 queued 让弹窗可见
    sendProgress(ctx, { id: input.id, fileName: input.outputName || '', status: 'queued', progress: 0 })

    const worker = new Worker(getWorkerPath())
    activeWorkers.set(input.id, worker)

    worker.on('message', (msg: any) => {
      if (msg.type === 'progress') {
        sendProgress(ctx, msg.state as ExportState)
      } else if (msg.type === 'done') {
        sendProgress(ctx, msg.state as ExportState)
        activeWorkers.delete(input.id)
        worker.terminate()
      } else if (msg.type === 'error') {
        sendProgress(ctx, { id: input.id, fileName: input.outputName || '', status: 'failed', progress: 100, error: msg.error })
        activeWorkers.delete(input.id)
        worker.terminate()
      }
    })

    worker.on('error', (err: Error) => {
      sendProgress(ctx, { id: input.id, fileName: input.outputName || '', status: 'failed', progress: 100, error: err.message })
      activeWorkers.delete(input.id)
    })

    worker.on('exit', () => {
      activeWorkers.delete(input.id)
    })

    worker.postMessage({ type: 'start', input })
  })

  ipcMain.on('luna-export:cancel', (_event, exportId: string) => {
    const worker = activeWorkers.get(exportId)
    if (worker) {
      worker.postMessage({ type: 'cancel', id: exportId })
    }
  })
}
