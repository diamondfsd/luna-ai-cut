import { app, ipcMain } from 'electron'
import type { MossTtsGenerationRequest } from '../src/shared/types'
import { mossTtsRuntime, shutdownMossTts } from './mossTtsService'

const PROGRESS_CHANNEL = 'moss-tts:progress'
const MAX_TEXT_LENGTH = 8_000
const MOSS_VOICES = new Set([
  'Junhao', 'Zhiming', 'Weiguo', 'Xiaoyu', 'Yuewen', 'Lingyu',
  'Trump', 'Ava', 'Bella', 'Adam', 'Nathan', 'Soyo', 'Saki',
  'Mortis', 'Umiri', 'Mei', 'Anon', 'Arisa',
])

function validateRequest(value: unknown): MossTtsGenerationRequest {
  if (!value || typeof value !== 'object') throw new Error('语音生成请求无效。')
  const request = value as Record<string, unknown>
  const requestId = typeof request.requestId === 'string' ? request.requestId.trim() : ''
  const text = typeof request.text === 'string' ? request.text.trim() : ''
  const voice = typeof request.voice === 'string' ? request.voice.trim() : ''
  const speed = request.speed === undefined ? 1 : Number(request.speed)
  const referenceAudioPath = request.referenceAudioPath === undefined
    ? undefined
    : typeof request.referenceAudioPath === 'string' ? request.referenceAudioPath.trim() : ''
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new Error('语音任务编号无效。')
  if (!text || text.length > MAX_TEXT_LENGTH) throw new Error('语音文本长度无效。')
  if (!voice || !MOSS_VOICES.has(voice)) throw new Error('MOSS 声音无效。')
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('语速必须在 0.5 到 2 倍之间。')
  if (referenceAudioPath !== undefined && !referenceAudioPath) throw new Error('参考音频路径无效。')
  return {
    requestId,
    text,
    voice,
    speed,
    ...(referenceAudioPath ? { referenceAudioPath } : {}),
  }
}

export function register(): void {
  ipcMain.handle('moss-tts:get-status', () => mossTtsRuntime.status())

  ipcMain.handle('moss-tts:generate', async (event, value: unknown) => {
    const request = validateRequest(value)
    const cancelOnDestroy = () => mossTtsRuntime.cancel(request.requestId)
    event.sender.once('destroyed', cancelOnDestroy)
    try {
      return await mossTtsRuntime.generate(request, (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(PROGRESS_CHANNEL, progress)
      })
    } finally {
      event.sender.removeListener('destroyed', cancelOnDestroy)
    }
  })

  ipcMain.handle('moss-tts:cancel', (_event, requestId: unknown) => {
    if (typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      mossTtsRuntime.cancel(requestId)
    }
  })

  ipcMain.handle('moss-tts:unload', () => mossTtsRuntime.unload())
  app.once('before-quit', () => { void shutdownMossTts() })
}
