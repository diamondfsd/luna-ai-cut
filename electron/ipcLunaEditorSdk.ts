import { BrowserWindow, ipcMain } from 'electron'

import { registerFreecutHarnessProvider } from './deepseekHarnessCapabilities'
import type { IpcContext } from './ipcContext'
import { createFreecutProvider } from './luna-editor-sdk/freecut-provider'
import { LunaEditorSdkError, type LunaEditorSdkContext, type LunaEditorSdkRequest } from './luna-editor-sdk/contracts'
import { executeRemotionCapability } from './remotionRenderService'

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

function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 返回值无效`)
  return value as Record<string, unknown>
}

function nonNegativeSeconds(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${field} 必须是非负数字`)
  return value
}

const pending = new Map<string, PendingRequest>()
let registered = false
const RENDERER_REQUEST_TIMEOUT_MS = 60_000
let getEditorWindow: () => BrowserWindow | null = () => null

function requestRenderer(
  request: LunaEditorSdkRequest,
  context: LunaEditorSdkContext,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) {
    return Promise.reject(new LunaEditorSdkError('ABORTED', 'FreeCut SDK 请求已取消。'))
  }
  const window = getEditorWindow()
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

async function executeRemotionTimelineCapability(
  request: LunaEditorSdkRequest,
  context: LunaEditorSdkContext,
): Promise<unknown> {
  const registered = recordValue(
    await executeRemotionCapability(request.name, request.args, context, context.signal),
    'Remotion 素材登记结果',
  )
  const media = recordValue(registered.media, 'Remotion 素材')
  const durationSeconds = typeof registered.durationSeconds === 'number' ? registered.durationSeconds : 0
  const startSeconds = nonNegativeSeconds(request.args.startSeconds, 'startSeconds', 0)
  const clipDurationSeconds = nonNegativeSeconds(request.args.durationSeconds, 'durationSeconds', durationSeconds)
  if (clipDurationSeconds <= 0 || clipDurationSeconds > durationSeconds) throw new RangeError('durationSeconds 超出 Remotion 素材时长')
  const timelineContext = recordValue(
    await requestRenderer({
      ...request,
      name: 'timeline.inspect_context',
      args: {},
    }, context, context.signal),
    '时间线信息',
  )
  const fps = typeof timelineContext.fps === 'number' && timelineContext.fps > 0 ? timelineContext.fps : 30
  const addResult = await requestRenderer({
    ...request,
    name: 'timeline.edit',
    args: {
      ops: [{
        op: 'addClip',
        mediaId: media.id,
        from: Math.round(startSeconds * fps),
        durationInFrames: Math.max(1, Math.round(clipDurationSeconds * fps)),
        ...(typeof request.args.trackId === 'string' ? { trackId: request.args.trackId } : {}),
      }],
      media: [media],
    },
  }, context, context.signal)
  return { ...registered, timeline: addResult }
}

/** Register the renderer-backed FreeCut implementation for Harness requests. */
export function register(context: IpcContext): void {
  if (registered) return
  getEditorWindow = () => context.win
  const disposeProvider = registerFreecutHarnessProvider(createFreecutProvider({
    execute: (request, context) => request.name === 'render.remotion.add_to_timeline'
      ? executeRemotionTimelineCapability(request, context)
      : request.name.startsWith('render.remotion.')
        ? executeRemotionCapability(request.name, request.args, context, context.signal)
        : requestRenderer(request, context, context.signal),
  }))
  try {
    ipcMain.on('luna-editor-sdk:response', handleRendererResponse)
    registered = true
  } catch (error) {
    disposeProvider()
    throw error
  }
}
