import { existsSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const videoPath = process.env.LUNA_E2E_VIDEO_PATH

test('WebGPU video preview preserves native video colors', async ({ lunaApp }) => {
  test.skip(process.platform !== 'win32', 'Windows color comparison')
  test.skip(!videoPath || !existsSync(videoPath), 'Set LUNA_E2E_VIDEO_PATH to a local video file')
  if (!videoPath) return

  const projectName = `WebGPU color debug ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath, fileName }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'workspace-webgpu-color-debug-video',
      name: fileName,
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath, fileName: path.basename(videoPath) })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })
  await lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName }).click()

  const preview = lunaApp.page.locator('canvas.webgpu-video-preview')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => lunaApp.page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.webgpu-video-preview')
    return canvas?.toDataURL('image/png').length ?? 0
  })).toBeGreaterThan(100)
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })

  const comparison = await lunaApp.page.evaluate(async (filePath) => {
    const source = document.querySelector<HTMLCanvasElement>('canvas.webgpu-video-preview')
    if (!source) throw new Error('missing WebGPU preview canvas')
    const normalized = filePath.replace(/\\/g, '/')
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.src = `file://${normalized.startsWith('/') ? '' : '/'}${encodeURI(normalized)}`
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error(video.error?.message ?? 'native video error')), { once: true })
      video.load()
    })
    if (video.currentTime !== 0) {
      await new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true })
        video.currentTime = 0
      })
    } else {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    const nativeCanvas = document.createElement('canvas')
    nativeCanvas.width = source.width
    nativeCanvas.height = source.height
    const nativeContext = nativeCanvas.getContext('2d', { willReadFrequently: true })
    if (!nativeContext) throw new Error('missing native 2d context')
    nativeContext.drawImage(video, 0, 0, nativeCanvas.width, nativeCanvas.height)
    const nativePixels = nativeContext.getImageData(0, 0, nativeCanvas.width, nativeCanvas.height).data

    const image = new Image()
    image.src = source.toDataURL('image/png')
    await image.decode()
    const webGpuCanvas = document.createElement('canvas')
    webGpuCanvas.width = source.width
    webGpuCanvas.height = source.height
    const webGpuContext = webGpuCanvas.getContext('2d', { willReadFrequently: true })
    if (!webGpuContext) throw new Error('missing WebGPU comparison context')
    webGpuContext.drawImage(image, 0, 0)
    const webGpuPixels = webGpuContext.getImageData(0, 0, source.width, source.height).data
    const deltas: number[] = []
    for (let index = 0; index < Math.min(nativePixels.length, webGpuPixels.length); index += 4) {
      deltas.push(Math.abs(nativePixels[index] - webGpuPixels[index]))
      deltas.push(Math.abs(nativePixels[index + 1] - webGpuPixels[index + 1]))
      deltas.push(Math.abs(nativePixels[index + 2] - webGpuPixels[index + 2]))
    }
    deltas.sort((left, right) => left - right)
    return {
      samples: deltas.length,
      meanAbsDelta: deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length),
      maxAbsDelta: deltas[deltas.length - 1] ?? 0,
      p95AbsDelta: deltas[Math.floor(deltas.length * 0.95)] ?? 0,
    }
  }, videoPath)
  console.log(`WebGPU color comparison: ${JSON.stringify(comparison)}`)
  expect(comparison.meanAbsDelta).toBeLessThan(1)
  expect(comparison.p95AbsDelta).toBeLessThan(3)
  expect(comparison.maxAbsDelta).toBeLessThan(8)
  expect(lunaApp.runtimeErrors).toEqual([])
})
