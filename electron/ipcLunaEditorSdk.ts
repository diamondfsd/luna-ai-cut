import { BrowserWindow, ipcMain } from 'electron'

import type { DeepSeekHarnessContext } from '../src/shared/types'
import { registerFreecutHarnessProvider } from './deepseekHarnessCapabilities'
import { createFreecutProvider } from './luna-editor-sdk/freecut-provider'
import { LunaEditorSdkError, type LunaEditorSdkRequest } from './luna-editor-sdk/contracts'

interface RendererResponse {
  requestId: string
  ok: boolean
  result?: unknown
  error?: { message?: string; code?: string; details?: unknown; retryable?: boolean }
}

interface PendingRequest {
  senderId: number
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

const pending = new Map<string, PendingRequest>()
let registered = false
const RENDERER_REQUEST_TIMEOUT_MS = 60_000

function requestRenderer(
  request: LunaEditorSdkRequest,
  context: DeepSeekHarnessContext,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) {
    return Promise.reject(new LunaEditorSdkError('ABORTED', 'FreeCut SDK 请求已取消。'))
  }
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
  if (!window || window.webContents.isDestroyed()) {
    return Promise.reject(new LunaEditorSdkError('WINDOW_UNAVAILABLE', 'FreeCut 编辑器窗口尚未打开。'))
  }
  if (pending.has(request.requestId)) {
    return Promise.reject(new LunaEditorSdkError('IPC_ERROR', `重复的 FreeCut SDK 请求：${request.requestId}`))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const timer: { id?: ReturnType<typeof setTimeout> } = {}
    const target = window.webContents
    const finish = (): void => {
      if (settled) return
      settled = true
      if (pending.get(request.requestId)?.senderId === target.id) pending.delete(request.requestId)
      signal.removeEventListener('abort', abort)
      target.removeListener('destroyed', onDestroyed)
      if (timer.id) clearTimeout(timer.id)
    }
    const sendCancel = (): void => {
      if (target.isDestroyed()) return
      try {
        target.send('luna-editor-sdk:cancel', { requestId: request.requestId })
      } catch {
        // The renderer can disappear between the state check and send().
      }
    }
    const abort = (): void => {
      sendCancel()
      finish()
      reject(new LunaEditorSdkError('ABORTED', 'FreeCut SDK 请求已取消。'))
    }
    const onDestroyed = (): void => {
      finish()
      reject(new LunaEditorSdkError('WINDOW_UNAVAILABLE', 'FreeCut 编辑器窗口已关闭。'))
    }

    pending.set(request.requestId, {
      senderId: target.id,
      resolve: (value) => {
        finish()
        resolve(value)
      },
      reject: (reason) => {
        finish()
        reject(reason)
      },
    })
    timer.id = setTimeout(() => {
      sendCancel()
      finish()
      reject(new LunaEditorSdkError('TIMEOUT', 'FreeCut SDK 请求超时，编辑器可能尚未完成加载。'))
    }, RENDERER_REQUEST_TIMEOUT_MS)
    signal.addEventListener('abort', abort, { once: true })
    target.once('destroyed', onDestroyed)
    if (signal.aborted) {
      abort()
      return
    }
    try {
      target.send('luna-editor-sdk:request', {
        requestId: request.requestId,
        sessionId: context.sessionId,
        projectId: context.projectId,
        name: request.name,
        args: request.args,
      })
    } catch (error) {
      finish()
      reject(new LunaEditorSdkError(
        'IPC_ERROR',
        error instanceof Error ? error.message : 'FreeCut SDK 请求发送失败。',
        error,
      ))
    }
  })
}

function handleRendererResponse(event: Electron.IpcMainEvent, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const response = value as RendererResponse
  if (typeof response.requestId !== 'string') return
  const request = pending.get(response.requestId)
  if (!request) return
  if (request.senderId !== event.sender.id) return
  if (response.ok === true) {
    request.resolve(response.result)
    return
  }
  const error = new Error(response.error?.message ?? 'FreeCut SDK 请求失败。') as Error & {
    code?: string
    details?: unknown
    retryable?: boolean
  }
  error.code = response.error?.code
  error.details = response.error?.details
  error.retryable = response.error?.retryable
  request.reject(error)
}

/** Register the renderer-backed FreeCut implementation for Harness requests. */
export function register(): void {
  if (registered) return
  const disposeProvider = registerFreecutHarnessProvider(createFreecutProvider({
    execute: (request, context) => requestRenderer(request, context, context.signal),
  }))
  try {
    ipcMain.on('luna-editor-sdk:response', handleRendererResponse)
    registered = true
  } catch (error) {
    disposeProvider()
    throw error
  }
}
