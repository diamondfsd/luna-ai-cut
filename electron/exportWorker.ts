/**
 * Export Worker — 在独立线程中执行导出，避免阻塞主进程
 *
 * 通过 worker_threads 运行 runExport，主进程通过 message 通信：
 *   - worker → parent: { type: 'progress', state }
 *   - parent → worker: { type: 'cancel' }
 */

import { parentPort } from 'node:worker_threads'
import { runExport, type ExportInput, type ExportCallbacks } from './lunaExportService'

const port = parentPort
if (!port) throw new Error('exportWorker must run as Worker')

port.on('message', (msg: any) => {
  if (msg.type === 'start') {
    const input: ExportInput = msg.input
    const ctrl = new AbortController()

    // 监听取消
    const cancelHandler = (m: any) => {
      if (m.type === 'cancel' && m.id === input.id) {
        ctrl.abort()
        port.off('message', cancelHandler)
      }
    }
    port.on('message', cancelHandler)

    const callbacks: ExportCallbacks = {
      signal: ctrl.signal,
      onProgress: (state) => {
        parentPort!.postMessage({ type: 'progress', state })
      },
    }

    runExport(input, callbacks).then((result) => {
      port.postMessage({ type: 'done', state: result })
      port.off('message', cancelHandler)
    }).catch((err: unknown) => {
      port.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) })
      port.off('message', cancelHandler)
    })
  }
})
