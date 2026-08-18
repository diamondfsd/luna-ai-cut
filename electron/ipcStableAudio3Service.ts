import { app, ipcMain } from 'electron'
import type { StableAudio3GenerationRequest, StableAudio3ModelId } from '../src/shared/types'
import { shutdownStableAudio3, stableAudio3Runtime } from './stableAudio3Service'

const PROGRESS_CHANNEL = 'stable-audio-3:progress'
const MAX_PROMPT_LENGTH = 1_000

function isModelId(value: unknown): value is StableAudio3ModelId {
  return value === 'small-music' || value === 'small-sfx'
}

function validateRequest(value: unknown): StableAudio3GenerationRequest {
  if (!value || typeof value !== 'object') throw new Error('音频生成请求无效。')
  const request = value as Record<string, unknown>
  const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : ''
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : ''
  const durationSeconds = Number(request.durationSeconds)
  const guidanceScale = request.guidanceScale === undefined ? undefined : Number(request.guidanceScale)
  const seed = request.seed === undefined ? undefined : Number(request.seed)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('音频任务编号无效。')
  if (!isModelId(request.model)) throw new Error('音频模型无效。')
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) throw new Error('音频描述长度无效。')
  if (!Number.isFinite(durationSeconds) || durationSeconds < 2 || durationSeconds > 30) {
    throw new Error('音频时长必须在 2 到 30 秒之间。')
  }
  if (guidanceScale !== undefined && (!Number.isFinite(guidanceScale) || guidanceScale < 0 || guidanceScale > 10)) {
    throw new Error('引导强度无效。')
  }
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647)) {
    throw new Error('随机种子无效。')
  }
  return {
    requestId,
    model: request.model,
    prompt,
    durationSeconds,
    ...(guidanceScale === undefined ? {} : { guidanceScale }),
    ...(seed === undefined ? {} : { seed }),
  }
}

export function register(): void {
  ipcMain.handle('stable-audio-3:get-status', () => stableAudio3Runtime.status())

  ipcMain.handle('stable-audio-3:generate', async (event, value: unknown) => {
    const request = validateRequest(value)
    const cancelOnDestroy = () => stableAudio3Runtime.cancel(request.requestId)
    event.sender.once('destroyed', cancelOnDestroy)
    try {
      return await stableAudio3Runtime.generate(request, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(PROGRESS_CHANNEL, progress)
      })
    } finally {
      event.sender.removeListener('destroyed', cancelOnDestroy)
    }
  })

  ipcMain.handle('stable-audio-3:cancel', (_event, requestId: unknown) => {
    if (typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      stableAudio3Runtime.cancel(requestId)
    }
  })

  ipcMain.handle('stable-audio-3:unload', () => stableAudio3Runtime.unload())
  app.once('before-quit', () => {
    void shutdownStableAudio3()
  })
}
