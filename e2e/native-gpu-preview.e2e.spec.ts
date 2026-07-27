import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  nativeHandle?: string
}

async function captureScreen(bounds: WindowBounds, outputPath: string): Promise<void> {
  const captureCommand = process.platform === 'win32' && bounds.nativeHandle
    ? [
        'Add-Type -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr hwnd, System.IntPtr hdc, uint flags);\' -Name NativeMethods -Namespace Win32',
        '$hdc = $graphics.GetHdc()',
        `[void][Win32.NativeMethods]::PrintWindow([IntPtr]::new([Int64]${bounds.nativeHandle}), $hdc, 2)`,
        '$graphics.ReleaseHdc($hdc)',
      ]
    : [
        `$graphics.CopyFromScreen(${bounds.x}, ${bounds.y}, 0, 0, $bitmap.Size)`,
      ]
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    `$bitmap = New-Object System.Drawing.Bitmap(${bounds.width}, ${bounds.height})`,
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    ...captureCommand,
    `$bitmap.Save('${outputPath.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
  ].join('; ')
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script])
}

test('原生 GPU 预览可播放、跳转并呈现画面', async ({ lunaApp }) => {
  test.skip(!['darwin', 'win32'].includes(process.platform), '原生 Surface 当前支持 macOS 和 Windows')
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

  const lutPath = path.join(process.cwd(), 'public', 'luts', '徕卡', 'Leica Eternal.cube')
  const restoreLutPath = path.join(
    process.cwd(),
    'public',
    'luts',
    'LunaUltra',
    'Luna_I-Log_to_Rec709_BT1886_s33_v2.cube',
  )
  const watermarkPath = path.join(
    process.cwd(),
    'src',
    'assets',
    'watermark',
    'ic_watermark_luna_ultra_image_cn.png',
  )

  const sessionResult = await lunaApp.page.evaluate(async ({
    sourcePath,
    lut,
    restoreLut,
    watermark,
  }) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        init: () => Promise<void>
        createNativePreviewSession: (composition: unknown, bounds: unknown) => Promise<number>
        playNativePreview: (sessionId: number, time: number) => Promise<void>
      }
    }).lunaRenderCore
    await api.init()
    const createStartedAt = performance.now()
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
        lutId: lut,
        restoreLutId: restoreLut,
        lutIntensity: 1,
      }, {
        id: 'watermark',
        layerType: 'media',
        source: { path: watermark, sourceType: 'image' },
        rect: { x: 0.65, y: 0.84, w: 0.3, h: 0.12 },
        sourceRect: { x: 0, y: 0, w: 1, h: 1 },
        fit: 'contain',
        opacity: 1,
        zIndex: 1,
        color: null,
      }],
    }, {
      x: 80,
      y: 80,
      width: 640,
      height: 360,
      scaleFactor: window.devicePixelRatio,
    })
    const createDuration = performance.now() - createStartedAt
    await api.playNativePreview(session, 0)
    return { session, createDuration }
  }, {
    sourcePath: videoPath,
    lut: lutPath,
    restoreLut: restoreLutPath,
    watermark: watermarkPath,
  })
  const sessionId = sessionResult.session
  if (process.platform === 'win32') {
    expect(sessionResult.createDuration).toBeLessThan(2_000)
  }

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

  const windowBounds = await lunaApp.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('找不到应用主窗口')
    window.show()
    window.restore()
    window.setAlwaysOnTop(true)
    window.focus()
    return {
      ...window.getBounds(),
      nativeHandle: process.platform === 'win32'
        ? window.getNativeWindowHandle().readBigUInt64LE(0).toString()
        : undefined,
    }
  })
  const outputDir = path.join(lunaApp.temporaryRoot, 'artifacts')
  const capturePath = path.join(outputDir, 'native-gpu-preview-window.png')
  await mkdir(outputDir, { recursive: true })
  await captureScreen(windowBounds, capturePath)
  const capturedWindow = await lunaApp.app.evaluate(async ({ nativeImage }, imagePath) => {
    const image = nativeImage.createFromPath(imagePath)
    return {
      empty: image.isEmpty(),
      size: image.getSize(),
    }
  }, capturePath)
  expect(capturedWindow.empty).toBe(false)
  expect(capturedWindow.size).toEqual({
    width: windowBounds.width,
    height: windowBounds.height,
  })
  await expect(lunaApp.page.locator('body')).toBeVisible()
  await expect.poll(() => lunaApp.page.evaluate(() => performance.now())).toBeGreaterThan(0)

  const framesBeforeResize = await lunaApp.page.evaluate(async (id) => {
    const api = (window as typeof window & {
      lunaRenderCore: {
        getNativePreviewSessionStats: (sessionId: number) => Promise<{ renderedFrames: number }>
        setNativePreviewBounds: (sessionId: number, bounds: unknown) => Promise<void>
      }
    }).lunaRenderCore
    const before = await api.getNativePreviewSessionStats(id)
    await api.setNativePreviewBounds(id, {
      x: 260,
      y: 180,
      width: 360,
      height: 200,
      scaleFactor: window.devicePixelRatio,
    })
    return before.renderedFrames
  }, sessionId)
  await expect.poll(async () => (
    lunaApp.page.evaluate(async (id) => {
      const api = (window as typeof window & {
        lunaRenderCore: {
          getNativePreviewSessionStats: (sessionId: number) => Promise<{ renderedFrames: number }>
        }
      }).lunaRenderCore
      return (await api.getNativePreviewSessionStats(id)).renderedFrames
    }, sessionId)
  )).toBeGreaterThan(framesBeforeResize)
  const resizedCapturePath = path.join(outputDir, 'native-gpu-preview-window-resized.png')
  await captureScreen(windowBounds, resizedCapturePath)

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
  await lunaApp.page.waitForTimeout(500)
  const withoutPreviewPath = path.join(outputDir, 'native-gpu-preview-window-without-surface.png')
  await captureScreen(windowBounds, withoutPreviewPath)
  const changedRegion = await lunaApp.app.evaluate(
    ({ nativeImage }, paths) => {
      const withPreview = nativeImage.createFromPath(paths.withPreview)
      const withoutPreview = nativeImage.createFromPath(paths.withoutPreview)
      const size = withPreview.getSize()
      if (
        withoutPreview.isEmpty()
        || size.width !== withoutPreview.getSize().width
        || size.height !== withoutPreview.getSize().height
      ) {
        throw new Error('预览截图尺寸不一致')
      }
      const left = withPreview.getBitmap()
      const right = withoutPreview.getBitmap()
      let minX = size.width
      let minY = size.height
      let maxX = -1
      let maxY = -1
      let changedPixels = 0
      for (let pixel = 0; pixel < size.width * size.height; pixel += 1) {
        const offset = pixel * 4
        const changed = Math.max(
          Math.abs(left[offset] - right[offset]),
          Math.abs(left[offset + 1] - right[offset + 1]),
          Math.abs(left[offset + 2] - right[offset + 2]),
        ) > 24
        if (!changed) continue
        const x = pixel % size.width
        const y = Math.floor(pixel / size.width)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        changedPixels += 1
      }
      return {
        changedPixels,
        x: minX,
        y: minY,
        width: maxX >= minX ? maxX - minX + 1 : 0,
        height: maxY >= minY ? maxY - minY + 1 : 0,
      }
    },
    { withPreview: resizedCapturePath, withoutPreview: withoutPreviewPath },
  )
  expect(changedRegion.changedPixels).toBeGreaterThan(20_000)
  expect(changedRegion.width).toBeGreaterThan(300)
  expect(changedRegion.width).toBeLessThan(440)
  expect(changedRegion.height).toBeGreaterThan(160)
  expect(changedRegion.height).toBeLessThan(260)
  if (process.platform === 'win32') {
    expect(changedRegion.x).toBeGreaterThan(240)
    expect(changedRegion.x).toBeLessThan(320)
    expect(changedRegion.y).toBeGreaterThan(200)
    expect(changedRegion.y).toBeLessThan(300)
  }
  expect(lunaApp.runtimeErrors).toEqual([])
})
