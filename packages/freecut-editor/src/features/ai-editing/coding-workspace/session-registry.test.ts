// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('./timeline-session', () => ({
  TimelineCodingSession: { create: mocks.create },
}))

import {
  clearTimelineCodingSession,
  getTimelineCodingSession,
  startTimelineCodingSession,
} from './session-registry'

describe('timeline coding session registry', () => {
  beforeEach(() => {
    clearTimelineCodingSession()
    mocks.create.mockReset()
  })

  it('prevents concurrent sessions from creating two production baselines', async () => {
    let resolveSession: (session: unknown) => void = () => undefined
    const session = { id: 'session-1' }
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )

    const first = startTimelineCodingSession()
    await expect(startTimelineCodingSession()).rejects.toThrow('已有剪辑代码工作区正在运行')
    resolveSession(session)

    expect(await first).toBe(session)
    expect(getTimelineCodingSession()).toBe(session)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('allows retry after working-copy creation fails', async () => {
    const session = { id: 'session-2' }
    mocks.create.mockRejectedValueOnce(new Error('capture failed')).mockResolvedValueOnce(session)

    await expect(startTimelineCodingSession()).rejects.toThrow('capture failed')
    await expect(startTimelineCodingSession()).resolves.toBe(session)
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('only clears a matching active session when a handle is supplied', async () => {
    const session = { id: 'session-3' }
    mocks.create.mockResolvedValue(session)
    await startTimelineCodingSession()

    clearTimelineCodingSession({ id: 'different' } as never)
    expect(getTimelineCodingSession()).toBe(session)

    clearTimelineCodingSession(session as never)
    expect(() => getTimelineCodingSession()).toThrow('剪辑代码工作区尚未启动')
  })
})
