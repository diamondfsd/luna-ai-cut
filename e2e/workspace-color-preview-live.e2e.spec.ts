import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')
const imagePath = path.join(projectRoot, 'test-data', 'color-masking', 'd3-effect-set', 'images', 'person', 'person-04.jpg')
const videoPath = path.join(projectRoot, 'electron', 'media', 'obs-demo', 'obs-demo.mp4')

async function canvasSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.preview-canvas-wrapper canvas')
    return canvas?.toDataURL('image/png') ?? ''
  })
}

async function openWorkspaceMedia(page: Page, options: { name: string; sourcePath: string; kind: 'image' | 'video'; webGpu: boolean }): Promise<void> {
  await page.evaluate(async ({ name, sourcePath, kind, webGpu }) => {
    await window.luna.saveSettings({ experimentalWebGpuPreview: webGpu })
    await window.luna.workspace.createProject(name, [{
      id: 'live-color-preview-image',
      name: kind === 'video' ? 'live-color-preview.mp4' : 'live-color-preview.jpg',
      path: sourcePath,
      kind,
    }])
  }, options)

  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => { window.location.hash = '#/workspace' })

  await page.locator('.workspace-project-open').filter({ hasText: options.name }).click()
}

async function exerciseLiveExposure(page: Page): Promise<void> {
  const preview = page.locator('.preview-canvas-wrapper canvas')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })

  const control = page.locator('.workspace-param-slider').nth(2)
  const slider = control.locator('.workspace-slider-root')
  const handle = slider.locator('[role="slider"]')
  await expect(handle).toHaveAttribute('aria-valuenow', '0')
  const box = await slider.boundingBox()
  if (!box) throw new Error('color slider is not laid out')

  const originalPreview = await canvasSignature(page)
  await page.evaluate(() => {
    const target = window as Window & { __colorSliderPointerUpCount?: number }
    target.__colorSliderPointerUpCount = 0
    document.addEventListener('pointerup', () => {
      target.__colorSliderPointerUpCount = (target.__colorSliderPointerUpCount ?? 0) + 1
    }, { capture: true })
  })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2)
    expect(Number(await handle.getAttribute('aria-valuenow'))).not.toBe(0)
    await expect.poll(() => canvasSignature(page)).not.toBe(originalPreview)
    expect(await page.evaluate(() => (window as Window & { __colorSliderPointerUpCount?: number }).__colorSliderPointerUpCount ?? 0)).toBe(0)
    const highExposurePreview = await canvasSignature(page)

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2)
    expect(Number(await handle.getAttribute('aria-valuenow'))).not.toBe(0)
    await expect.poll(() => canvasSignature(page)).not.toBe(highExposurePreview)
    expect(await page.evaluate(() => (window as Window & { __colorSliderPointerUpCount?: number }).__colorSliderPointerUpCount ?? 0)).toBe(0)
  } finally {
    await page.mouse.up()
  }

  await expect(control.locator('input.workspace-param-value-input')).not.toHaveValue('0')
}

test('workspace color slider updates an image preview while pointer remains down', async ({ lunaApp }) => {
  const projectName = `live image color preview ${Date.now()}`
  await openWorkspaceMedia(lunaApp.page, { name: projectName, sourcePath: imagePath, kind: 'image', webGpu: true })
  await exerciseLiveExposure(lunaApp.page)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('workspace color slider updates a WebGPU video preview while pointer remains down', async ({ lunaApp }) => {
  if (!existsSync(videoPath)) throw new Error(`workspace video fixture unavailable: ${videoPath}`)
  const projectName = `live video color preview ${Date.now()}`
  await openWorkspaceMedia(lunaApp.page, { name: projectName, sourcePath: videoPath, kind: 'video', webGpu: true })
  await exerciseLiveExposure(lunaApp.page)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('workspace color slider updates a standard image preview while pointer remains down', async ({ lunaApp }) => {
  const projectName = `live standard image color preview ${Date.now()}`
  await openWorkspaceMedia(lunaApp.page, { name: projectName, sourcePath: imagePath, kind: 'image', webGpu: false })
  await exerciseLiveExposure(lunaApp.page)
  expect(lunaApp.runtimeErrors).toEqual([])
})
