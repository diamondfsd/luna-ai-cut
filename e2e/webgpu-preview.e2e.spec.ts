import { execFile } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'
import type { Page } from '@playwright/test'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

async function clickNavigationLinkAtPoint(page: Page, name: string, path: string): Promise<void> {
  const link = page.getByRole('link', { name })
  const box = await link.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    return {
      tag: element?.tagName ?? null,
      className: typeof element?.className === 'string' ? element.className : null,
      href: element?.closest('a')?.getAttribute('href') ?? null,
    }
  }, point)
  expect(hit.href).toContain(path)
  await page.mouse.click(point.x, point.y)
}

async function previewAnchorProjection(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.webgpu-video-preview')
    const frame = canvas?.parentElement
    if (!canvas || !frame) return null
    const frameRect = frame.getBoundingClientRect()
    const centerX = frameRect.left + frameRect.width / 2
    const centerY = frameRect.top + frameRect.height / 2
    const offsetX = canvas.clientWidth * 0.16
    const offsetY = canvas.clientHeight * 0.12
    const pointerX = centerX + offsetX
    const pointerY = centerY + offsetY
    const canvasRect = canvas.getBoundingClientRect()
    const scale = new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a
    return {
      pointerX,
      pointerY,
      projectedX: (canvasRect.left + canvasRect.right) / 2 + offsetX * scale,
      projectedY: (canvasRect.top + canvasRect.bottom) / 2 + offsetY * scale,
      scale,
    }
  })
}

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
    '-i', 'testsrc2=size=1920x1080:rate=30',
    '-t', '1.5',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y', videoPath,
  ])
  const localResourcesDir = path.join(lunaApp.temporaryRoot, 'downloads', 'localResources')
  await mkdir(localResourcesDir, { recursive: true })
  await copyFile(videoPath, path.join(localResourcesDir, 'local-preview.mp4'))

  const projectName = `WebGPU 预览 ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => {
    await window.luna.saveSettings({
      experimentalWebGpuPreview: true,
      workspacePreviewQuality: 'smooth',
    })
    await window.luna.workspace.createProject(name, [{
      id: 'webgpu-preview-video',
      name: 'webgpu-preview.mp4',
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath })

  const staleLutPath = path.join(path.dirname(lunaApp.temporaryRoot), 'old-worktree', 'public', 'luts', '富士胶片', 'nostalgic-neg_sRGB.cube')
  const lutLoaded = await lunaApp.page.evaluate(async (filePath) => {
    const bytes = await window.luna.workspace.loadLut(filePath)
    return bytes instanceof ArrayBuffer && bytes.byteLength > 0
  }, staleLutPath)
  expect(lutLoaded).toBe(true)

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
  })).toMatchObject({ width: 960, height: 540 })
  await expect.poll(async () => lunaApp.page.evaluate(() => {
    const canvas = document.querySelector('canvas.webgpu-video-preview') as HTMLCanvasElement | null
    return canvas?.toDataURL('image/png').length ?? 0
  })).toBeGreaterThan(100)

  const beforeZoom = await previewAnchorProjection(lunaApp.page)
  expect(beforeZoom).not.toBeNull()
  if (!beforeZoom) throw new Error('WebGPU 预览画布未准备好缩放锚点测试')
  await lunaApp.page.mouse.move(beforeZoom.pointerX, beforeZoom.pointerY)
  await lunaApp.page.mouse.wheel(0, -120)
  await expect.poll(async () => (await previewAnchorProjection(lunaApp.page))?.scale ?? 1).toBeGreaterThan(1.01)
  const afterZoom = await previewAnchorProjection(lunaApp.page)
  expect(afterZoom).not.toBeNull()
  if (!afterZoom) throw new Error('WebGPU 预览画布在缩放后消失')
  expect(Math.abs(afterZoom.projectedX - beforeZoom.projectedX)).toBeLessThan(2)
  expect(Math.abs(afterZoom.projectedY - beforeZoom.projectedY)).toBeLessThan(2)
  await lunaApp.page.locator('.workspace-zoom-value').click()
  await expect.poll(async () => (await previewAnchorProjection(lunaApp.page))?.scale ?? 0).toBeCloseTo(1, 2)

  const playback = lunaApp.page.locator('.ui-video-controls-button')
  await expect(playback).toHaveAttribute('aria-label', '播放')
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', '暂停')
  await lunaApp.page.waitForTimeout(150)
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', '播放')

  await clickNavigationLinkAtPoint(lunaApp.page, '设置', '/settings')
  await expect.poll(() => lunaApp.page.evaluate(() => window.location.hash)).toBe('#/settings')
  await expect(lunaApp.page.locator('.settings-surface')).toBeVisible()
  await expect(lunaApp.page.locator('.workspace-layout')).toHaveCount(0)
  await clickNavigationLinkAtPoint(lunaApp.page, '工作台', '/workspace')
  await expect(lunaApp.page.locator('.workspace-layout')).toBeVisible()

  await lunaApp.page.getByRole('link', { name: '本地资源' }).click()
  await expect(lunaApp.page.locator('.media-frame').first()).toBeVisible({ timeout: 15_000 })
  await lunaApp.page.locator('.media-frame').first().click()
  await expect(lunaApp.page.locator('.preview-modal')).toBeVisible()
  await clickNavigationLinkAtPoint(lunaApp.page, '设置', '/settings')
  await expect.poll(() => lunaApp.page.evaluate(() => window.location.hash)).toBe('#/settings')
  await expect(lunaApp.page.locator('.settings-surface')).toBeVisible()
  await expect(lunaApp.page.locator('.workspace-layout')).toHaveCount(0)
  await expect(lunaApp.page.locator('.preview-modal')).toHaveCount(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
