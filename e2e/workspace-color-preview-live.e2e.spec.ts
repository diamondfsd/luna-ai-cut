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

async function openWorkspaceMedia(page: Page, options: { name: string; sourcePath: string; kind: 'image' | 'video'; webGpu: boolean; initialContrast?: number }): Promise<void> {
  await page.evaluate(async ({ name, sourcePath, kind, webGpu, initialContrast }) => {
    await window.luna.saveSettings({ experimentalWebGpuPreview: webGpu })
    const asset = {
      id: 'live-color-preview-image',
      name: kind === 'video' ? 'live-color-preview.mp4' : 'live-color-preview.jpg',
      path: sourcePath,
      kind,
    }
    if (initialContrast !== undefined) Object.assign(asset, {
      pipeline: {
        color: {
          contrast: initialContrast,
          glowStrength: 0,
          glowRadius: 35,
          glowThreshold: 65,
        },
      },
    })
    await window.luna.workspace.createProject(name, [asset])
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
  const sliderMin = Number(await handle.getAttribute('aria-valuemin'))
  const sliderMax = Number(await handle.getAttribute('aria-valuemax'))
  const sliderStepAttribute = Number(await handle.getAttribute('aria-valuestep'))
  const sliderStep = Number.isFinite(sliderStepAttribute) && sliderStepAttribute > 0 ? sliderStepAttribute : 1

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
    const moveSliderWhilePressed = async (fromRatio: number, toRatio: number): Promise<void> => {
      const steps = 24
      for (let step = 1; step <= steps; step += 1) {
        const ratio = fromRatio + ((toRatio - fromRatio) * step) / steps
        await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2)
        const expected = sliderMin + (sliderMax - sliderMin) * ratio
        const tolerance = Math.max(sliderStep, 0.01) + 0.01
        await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(expected - tolerance)
        await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(expected + tolerance)
        await page.waitForTimeout(12)
      }
    }

    await moveSliderWhilePressed(0.5, 0.75)
    expect(await page.evaluate(() => (window as Window & { __colorSliderPointerUpCount?: number }).__colorSliderPointerUpCount ?? 0)).toBe(0)
    await expect.poll(() => canvasSignature(page)).not.toBe(originalPreview)
    const highExposurePreview = await canvasSignature(page)

    await moveSliderWhilePressed(0.75, 0.25)
    await expect.poll(() => canvasSignature(page)).not.toBe(highExposurePreview)
    expect(await page.evaluate(() => (window as Window & { __colorSliderPointerUpCount?: number }).__colorSliderPointerUpCount ?? 0)).toBe(0)

    for (let sample = 0; sample < 12; sample += 1) {
      await page.waitForTimeout(40)
      expect(await canvasSignature(page)).not.toBe(originalPreview)
    }
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

test('workspace color slider keeps existing color while a WebGPU video preview is dragged', async ({ lunaApp }) => {
  if (!existsSync(videoPath)) throw new Error(`workspace video fixture unavailable: ${videoPath}`)
  const projectName = `live committed color preview ${Date.now()}`
  await openWorkspaceMedia(lunaApp.page, {
    name: projectName,
    sourcePath: videoPath,
    kind: 'video',
    webGpu: true,
    initialContrast: 30,
  })
  await exerciseLiveExposure(lunaApp.page)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('workspace color slider updates a standard image preview while pointer remains down', async ({ lunaApp }) => {
  const projectName = `live standard image color preview ${Date.now()}`
  await openWorkspaceMedia(lunaApp.page, { name: projectName, sourcePath: imagePath, kind: 'image', webGpu: false })
  await exerciseLiveExposure(lunaApp.page)
  expect(lunaApp.runtimeErrors).toEqual([])
})
