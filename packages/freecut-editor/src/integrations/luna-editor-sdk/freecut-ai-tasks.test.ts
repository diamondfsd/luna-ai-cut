// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vite-plus/test'

const generateSpeechMock = vi.hoisted(() => vi.fn(() => new Promise<never>(() => undefined)))

vi.mock('@freecut/shared/host/embedded-host', () => ({
  getEmbeddedHostBridge: () => ({ generateSpeech: generateSpeechMock }),
}))

import { startAudioTask } from './freecut-ai-tasks'

describe('FreeCut SDK audio tasks', () => {
  it('returns the queued task before entering the host generation bridge', async () => {
    const task = startAudioTask({
      projectId: 'project-1',
      kind: 'speech',
      text: 'OBS 与 UVC 摄像头',
      voice: 'Junhao',
      speed: 1,
    })

    expect(task.status).toBe('queued')
    expect(generateSpeechMock).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(generateSpeechMock).toHaveBeenCalledTimes(1)
  })
})
