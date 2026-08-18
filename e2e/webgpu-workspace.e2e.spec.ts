import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

function readPngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('导出文件不是有效 PNG')
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

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
  await lunaApp.page.locator('.workspace-tool-rail button[aria-label="水印"]').click()
  const watermarkSwitch = lunaApp.page.getByRole('switch', { name: '启用水印' })
  await expect(watermarkSwitch).toBeVisible()
  if (await watermarkSwitch.getAttribute('data-state') !== 'unchecked') {
    await watermarkSwitch.click()
    await expect(watermarkSwitch).toHaveAttribute('data-state', 'unchecked')
  }

  const canvas = lunaApp.page.locator('.preview-canvas-wrapper canvas[data-renderer="webgpu"]')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement
    return target.toDataURL('image/png').length
  }), { timeout: 30_000 }).toBeGreaterThan(1_000)

  const webGpuExportPromise = lunaApp.page.evaluate(() => new Promise<boolean>((resolve) => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ backend?: string; status?: string }>).detail
      if (detail?.backend !== 'webgpu' || detail.status !== 'exporting') return
      window.removeEventListener('luna:export-progress-local', handle)
      resolve(true)
    }
    window.addEventListener('luna:export-progress-local', handle)
    window.setTimeout(() => {
      window.removeEventListener('luna:export-progress-local', handle)
      resolve(false)
    }, 30_000)
  }))
  await lunaApp.page.getByRole('button', { name: '导出', exact: true }).click()
  const exportDialog = lunaApp.page.getByRole('dialog', { name: '导出设置' })
  await expect(exportDialog).toBeVisible()
  const imageFormatRow = exportDialog.locator('.export-settings-row').filter({ hasText: '图片格式' })
  await imageFormatRow.getByRole('combobox', { name: '图片格式' }).click()
  await lunaApp.page.getByRole('option', { name: 'PNG', exact: true }).click()
  const resolutionRow = exportDialog.locator('.export-settings-row').filter({ hasText: '分辨率' })
  await resolutionRow.getByRole('combobox').click()
  await lunaApp.page.getByRole('option', { name: '4K', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '确认导出', exact: true }).click()
  await expect.poll(() => webGpuExportPromise, { timeout: 30_000 }).toBe(true)

  const exportDir = path.join(lunaApp.baseDir, 'export')
  await expect.poll(async () => {
    const names = await readdir(exportDir).catch(() => [])
    return names.some((name) => name.endsWith('.png'))
  }, { timeout: 30_000 }).toBe(true)
  const exportedName = (await readdir(exportDir)).find((name) => name.endsWith('.png'))
  expect(exportedName).toBeTruthy()
  const exportedFile = path.join(exportDir, exportedName!)
  expect((await stat(exportedFile)).size).toBeGreaterThan(1_000)
  expect(readPngSize(await readFile(exportedFile))).toEqual({ width: 3840, height: 2160 })

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

  const webGpuVideoExportPromise = lunaApp.page.evaluate(() => new Promise<boolean>((resolve) => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ backend?: string; status?: string; fileName?: string }>).detail
      if (detail?.backend !== 'webgpu' || detail.status !== 'exporting' || !detail.fileName?.endsWith('.mp4')) return
      window.removeEventListener('luna:export-progress-local', handle)
      resolve(true)
    }
    window.addEventListener('luna:export-progress-local', handle)
    window.setTimeout(() => {
      window.removeEventListener('luna:export-progress-local', handle)
      resolve(false)
    }, 90_000)
  }))
  await lunaApp.page.getByRole('button', { name: '导出', exact: true }).click()
  const videoExportDialog = lunaApp.page.getByRole('dialog', { name: '导出设置' })
  await expect(videoExportDialog).toBeVisible()
  const videoResolutionRow = videoExportDialog.locator('.export-settings-row').filter({ hasText: '分辨率' })
  await videoResolutionRow.getByRole('combobox').click()
  await lunaApp.page.getByRole('option', { name: '1080p', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '确认导出', exact: true }).click()
  await expect.poll(() => webGpuVideoExportPromise, { timeout: 90_000 }).toBe(true)

  await expect.poll(async () => {
    const names = await readdir(exportDir).catch(() => [])
    return names.some((name) => name.endsWith('.mp4'))
  }, { timeout: 90_000 }).toBe(true)
  const exportedVideoName = (await readdir(exportDir)).find((name) => name.endsWith('.mp4'))
  expect(exportedVideoName).toBeTruthy()
  const exportedVideoFile = path.join(exportDir, exportedVideoName!)
  expect((await stat(exportedVideoFile)).size).toBeGreaterThan(1_000)
  await execFileAsync(ffmpegPath, ['-v', 'error', '-i', exportedVideoFile, '-frames:v', '1', '-f', 'null', '-'])

  expect(lunaApp.runtimeErrors).toEqual([])
})
