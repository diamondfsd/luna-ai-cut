import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('Electron WebGPU 基础视频预览可播放、暂停并安全切页', async ({ lunaApp }) => {
  const hasWebGpu = await lunaApp.page.evaluate(async () => {
    const gpu = (navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown> }
    }).gpu
    return Boolean(gpu && await gpu.requestAdapter())
  })
  test.skip(!hasWebGpu, '当前 Electron 运行环境没有可用的 WebGPU 设备')
  if (!ffmpegPath) throw new Error('视频测试素材生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'webgpu-preview.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-t', '1.5',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y', videoPath,
  ])

  const projectName = `WebGPU 预览 ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => {
    await window.luna.saveSettings({
      experimentalGpuPreview: false,
      experimentalWebGpuPreview: true,
    })
    await window.luna.workspace.createProject(name, [{
      id: 'webgpu-preview-video',
      name: 'webgpu-preview.mp4',
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  await lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName }).click()
  const preview = lunaApp.page.locator('canvas.webgpu-video-preview')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => lunaApp.page.evaluate(() => {
    const canvas = document.querySelector('canvas.webgpu-video-preview') as HTMLCanvasElement | null
    if (!canvas) return { width: 0, height: 0, dataLength: 0 }
    return { width: canvas.width, height: canvas.height, dataLength: canvas.toDataURL('image/png').length }
  })).toMatchObject({ width: 640, height: 360 })
  await expect.poll(async () => lunaApp.page.evaluate(() => {
    const canvas = document.querySelector('canvas.webgpu-video-preview') as HTMLCanvasElement | null
    return canvas?.toDataURL('image/png').length ?? 0
  })).toBeGreaterThan(100)

  const playback = lunaApp.page.locator('.ui-video-controls-button')
  await expect(playback).toHaveAttribute('aria-label', '播放')
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', '暂停')
  await lunaApp.page.waitForTimeout(150)
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', '播放')

  await lunaApp.page.evaluate(() => { window.location.hash = '#/settings' })
  await expect(lunaApp.page.locator('.settings-surface')).toBeVisible()
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })
  await expect(lunaApp.page.locator('.workspace-layout')).toBeVisible()
  expect(lunaApp.runtimeErrors).toEqual([])
})
