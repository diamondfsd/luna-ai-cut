import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('macOS 原生 GPU 预览可播放、跳转并呈现画面', async ({ lunaApp }) => {
  test.skip(process.platform !== 'darwin', '原生 Surface 当前先接入 macOS')
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'native-preview.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-t', '3',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])
  const replacementVideoPath = path.join(lunaApp.temporaryRoot, 'native-preview-replacement.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=480x270:rate=30',
    '-t', '3',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-movflags', '+faststart',
    '-y',
    replacementVideoPath,
  ])

  const sessionId = await lunaApp.page.evaluate(async ({ sourcePath }) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        createNativePreviewSession: (composition: unknown, bounds: unknown) => Promise<number>
        playNativePreview: (sessionId: number, time: number) => Promise<void>
      }
    }).lunaRenderCore
    const session = await api.createNativePreviewSession({
      version: 1,
      canvas: { width: 640, height: 360, fps: 30, duration: 3 },
      layers: [{
        id: 'source',
        layerType: 'media',
        source: { path: sourcePath, sourceType: 'video' },
        rect: { x: 0, y: 0, w: 1, h: 1 },
        sourceRect: { x: 0, y: 0, w: 1, h: 1 },
        fit: 'cover',
        opacity: 1,
        zIndex: 0,
        maskPath: null,
        color: null,
        positioning: undefined,
      }],
    }, {
      x: 80,
      y: 80,
      width: 640,
      height: 360,
      scaleFactor: window.devicePixelRatio,
    })
    await api.playNativePreview(session, 0)
    return session
  }, { sourcePath: videoPath })

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (sessionId: number) => Promise<{
            renderedFrames: number
            renderErrors: number
            currentTime: number
          }>
        }
      }).lunaRenderCore
      return api.getNativePreviewSessionStats(id)
    }, sessionId)
  )).toMatchObject({ renderErrors: 0 })

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (sessionId: number) => Promise<{ renderedFrames: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).renderedFrames
    }, sessionId)
  )).toBeGreaterThan(3)

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (sessionId: number) => Promise<{ cacheMisses: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).cacheMisses
    }, sessionId)
  )).toBeGreaterThan(0)

  await lunaApp.page.evaluate(async (id) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        seekNativePreview: (sessionId: number, time: number) => Promise<void>
      }
    }).lunaRenderCore
    await api.seekNativePreview(id, 0)
  }, sessionId)

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (sessionId: number) => Promise<{ cacheHits: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).cacheHits
    }, sessionId)
  )).toBeGreaterThan(0)

  const framesBeforeRandomSeek = await lunaApp.page.evaluate(async (id) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        seekNativePreview: (sessionId: number, time: number) => Promise<void>
        getNativePreviewSessionStats: (
          sessionId: number,
        ) => Promise<{ renderedFrames: number }>
      }
    }).lunaRenderCore
    const before = await api.getNativePreviewSessionStats(id)
    await api.seekNativePreview(id, 1.5)
    return before.renderedFrames
  }, sessionId)

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (sessionId: number) => Promise<{ currentTime: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).currentTime
    }, sessionId)
  )).toBeGreaterThan(1.4)

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (
            sessionId: number,
          ) => Promise<{ renderedFrames: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).renderedFrames
    }, sessionId)
  )).toBeGreaterThan(framesBeforeRandomSeek)

  const framesBeforeMaterialSwitch = await lunaApp.page.evaluate(
    async ({ id, replacementPath }) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          updateNativePreviewComposition: (
            sessionId: number,
            composition: unknown,
          ) => Promise<void>
          seekNativePreview: (sessionId: number, time: number) => Promise<void>
          getNativePreviewSessionStats: (
            sessionId: number,
          ) => Promise<{ renderedFrames: number }>
        }
      }).lunaRenderCore
      const before = await api.getNativePreviewSessionStats(id)
      await api.updateNativePreviewComposition(id, {
        version: 1,
        canvas: { width: 480, height: 270, fps: 30, duration: 3 },
        layers: [{
          id: 'replacement',
          layerType: 'media',
          source: { path: replacementPath, sourceType: 'video' },
          rect: { x: 0, y: 0, w: 1, h: 1 },
          sourceRect: { x: 0, y: 0, w: 1, h: 1 },
          fit: 'cover',
          opacity: 1,
          zIndex: 0,
          color: null,
        }],
      })
      await api.seekNativePreview(id, 0.5)
      return before.renderedFrames
    },
    { id: sessionId, replacementPath: replacementVideoPath },
  )

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (
            sessionId: number,
          ) => Promise<{ renderedFrames: number; renderErrors: number }>
        }
      }).lunaRenderCore
      return api.getNativePreviewSessionStats(id)
    }, sessionId)
  )).toMatchObject({
    renderedFrames: expect.any(Number),
    renderErrors: 0,
  })

  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (
            sessionId: number,
          ) => Promise<{ renderedFrames: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).renderedFrames
    }, sessionId)
  )).toBeGreaterThan(framesBeforeMaterialSwitch)

  expect((await lunaApp.page.evaluate(async (id) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        getNativePreviewSessionStats: (
          sessionId: number,
        ) => Promise<{ renderErrors: number }>
      }
    }).lunaRenderCore
    return api.getNativePreviewSessionStats(id)
  }, sessionId)).renderErrors).toBe(0)

  await lunaApp.page.evaluate(async (id) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        destroyNativePreviewSession: (sessionId: number) => Promise<void>
      }
    }).lunaRenderCore
    await api.destroyNativePreviewSession(id)
  }, sessionId)
  expect(lunaApp.runtimeErrors).toEqual([])
})
