import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('真实工作台默认使用 WebGPU 预览图片和视频', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('测试媒体生成工具不可用')

  const imagePath = path.join(lunaApp.temporaryRoot, 'webgpu-workspace-image.png')
  const videoPath = path.join(lunaApp.temporaryRoot, 'webgpu-workspace-video.mp4')
  await Promise.all([
    execFileAsync(ffmpegPath, [
      '-f', 'lavfi',
      '-i', 'testsrc2=size=640x360:rate=1',
      '-frames:v', '1',
      '-y', imagePath,
    ]),
    execFileAsync(ffmpegPath, [
      '-f', 'lavfi',
      '-i', 'testsrc2=size=640x360:rate=30',
      '-t', '2',
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-movflags', '+faststart',
      '-y', videoPath,
    ]),
  ])

  await lunaApp.page.evaluate(async ({ image, video }) => {
    await window.luna.workspace.createProject('WebGPU workspace E2E', [
      { id: 'webgpu-workspace-image', name: 'webgpu-workspace-image.png', path: image, kind: 'image' },
      { id: 'webgpu-workspace-video', name: 'webgpu-workspace-video.mp4', path: video, kind: 'video' },
    ])
  }, { image: imagePath, video: videoPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => {
    window.location.hash = '#/workspace'
  })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: 'WebGPU workspace E2E' })
  await expect(project).toBeVisible()
  await project.click()
  await expect(lunaApp.page.getByRole('button', { name: '创意', exact: true })).toHaveCount(0)

  const canvas = lunaApp.page.locator('.preview-canvas-wrapper canvas[data-renderer="webgpu"]')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    return target.toDataURL('image/png').length
  }), { timeout: 30_000 }).toBeGreaterThan(1_000)

  await lunaApp.page.locator('.workspace-thumb[data-media-index="1"]').click()
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect(lunaApp.page.locator('video.webgpu-video-source')).toHaveCount(1)
  await expect.poll(async () => lunaApp.page.locator('video.webgpu-video-source').evaluate((element) => (
    (element as HTMLVideoElement).readyState
  )), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    return target.toDataURL('image/png').length
  }), { timeout: 30_000 }).toBeGreaterThan(1_000)

  expect(lunaApp.runtimeErrors).toEqual([])
})
