import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

async function renderedPixelCount(canvas: import('@playwright/test').Locator): Promise<number> {
  return canvas.evaluate(async (element) => {
    const source = element as HTMLCanvasElement
    if (source.width === 0 || source.height === 0) return 0
    const image = new Image()
    image.src = source.toDataURL('image/png')
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = image.naturalWidth || source.width
    sample.height = image.naturalHeight || source.height
    const context = sample.getContext('2d')
    if (!context) return 0
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 30 && pixels[index + 3] > 10) count += 1
    }
    return count
  })
}

test('像素流光视频播放不会持续 seek 或卡住', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'pixel-flow-playback.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=30',
    '-t', '6',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y', videoPath,
  ])

  const projectName = await lunaApp.page.evaluate(async (sourcePath) => {
    const width = 320
    const height = 180
    const asset = {
      id: 'pixel-flow-video-asset',
      name: 'pixel-flow-playback.mp4',
      path: sourcePath,
      kind: 'video' as const,
    }
    const project = await window.luna.workspace.createProject('像素流光视频播放 E2E', [asset])
    const depthMask = new Uint8Array(width * height).fill(255)
    const savedDepth = await window.luna.workspace.saveColorMask(
      project.id,
      'pixel-flow-video-depth',
      width,
      height,
      depthMask,
      1,
    )
    const pixelFlow = {
      settingsVersion: 18,
      duration: 6,
      pixelCount: 120,
      lightWidth: 24,
      initialSaturation: 0,
      initialBrightness: 0,
      subjectDirection: 'down' as const,
      rainSpeed: 50,
      rainLength: 40,
      flowStrength: 80,
      subjectDelay: 0,
      bloomStrength: 0.3,
      filterStrength: 0.5,
      colorTransition: 0.5,
      depthMaskPath: savedDepth.path,
      maskAssetId: asset.id,
    }
    await window.luna.workspace.saveProject({
      ...project,
      creative: {
        ...project.creative,
        pixelFlow,
        pixelFlowByAssetId: { [asset.id]: pixelFlow },
      },
    })
    return project.name
  }, videoPath)

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })
  await lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName }).click()
  await lunaApp.page.getByRole('button', { name: '创意' }).click()
  await lunaApp.page.locator('.workspace-creative-panel-list').getByRole('button', { name: /像素流光/ }).click()

  const canvas = lunaApp.page.locator('canvas.pixel-flow-canvas')
  const video = lunaApp.page.locator('video.webgpu-video-source')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect(video).toBeAttached({ timeout: 30_000 })
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 30_000 }).toBeGreaterThan(0.2)
  await expect.poll(() => renderedPixelCount(canvas), { timeout: 30_000 }).toBeGreaterThan(0)

  const startTime = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  await lunaApp.page.waitForTimeout(1_000)
  const endTime = await video.evaluate((element) => (element as HTMLVideoElement).currentTime)
  expect(endTime - startTime).toBeGreaterThan(0.5)
  await expect.poll(() => renderedPixelCount(canvas), { timeout: 10_000 }).toBeGreaterThan(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
