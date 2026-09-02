import { existsSync } from 'node:fs'
import path from 'node:path'


import { expect, test } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')
const videoPath = path.join(projectRoot, 'electron', 'media', 'obs-demo', 'obs-demo.mp4')

test('workspace color slider previews live and commits one history entry', async ({ lunaApp }) => {
  if (!existsSync(videoPath)) throw new Error(`workspace video fixture unavailable: ${videoPath}`)

  const projectName = `color slider ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, sourcePath }) => {
    await window.luna.saveSettings({ experimentalWebGpuPreview: false })
    await window.luna.workspace.createProject(name, [{
      id: 'color-slider-video',
      name: 'color-slider.mp4',
      path: sourcePath,
      kind: 'video',
    }])
  }, { name: projectName, sourcePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName })
  await expect(project).toBeVisible()
  await project.click()
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })

  const control = lunaApp.page.locator('.workspace-param-slider').nth(2)
  const slider = control.locator('.workspace-slider-root')
  await expect(slider.locator('[role="slider"]')).toHaveAttribute('aria-valuenow', '0')
  const box = await slider.boundingBox()
  if (!box) throw new Error('color slider is not laid out')

  const previewBox = await lunaApp.page.locator('.preview-canvas-wrapper').boundingBox()
  if (!previewBox) throw new Error('preview is not laid out')
  const previewSignature = async (): Promise<Buffer> => lunaApp.page.screenshot({ clip: previewBox })
  const originalSignature = await previewSignature()

  await lunaApp.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await lunaApp.page.mouse.down()
  const handle = slider.locator('[role="slider"]')
  for (const ratio of [0.75, 0.6, 0.8, 0.7, 0.25]) {
    await lunaApp.page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2, { steps: 4 })
  }

  const draggedValue = await handle.getAttribute('aria-valuenow')
  expect(Number(draggedValue)).not.toBe(0)
  await expect.poll(async () => Buffer.compare(await previewSignature(), originalSignature) !== 0, { timeout: 2_000 }).toBe(true)
  const lowExposureSignature = await previewSignature()

  for (let sample = 0; sample < 12; sample += 1) {
    await lunaApp.page.waitForTimeout(40)
    expect(Buffer.compare(await previewSignature(), originalSignature)).not.toBe(0)
  }

  await lunaApp.page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 })
  await expect.poll(async () => Buffer.compare(await previewSignature(), lowExposureSignature) !== 0, { timeout: 2_000 }).toBe(true)

  await lunaApp.page.mouse.up()

  await expect(handle).not.toHaveAttribute('aria-valuenow', '0')
  await expect(control.locator('input.workspace-param-value-input')).not.toHaveValue('0')

  await expect.poll(async () => lunaApp.page.evaluate(async (name) => {
    const project = (await window.luna.workspace.listProjects()).find((item) => item.name === name)
    return project?.assets[0]?.pipeline?.color?.exposure ?? 0
  }, projectName)).not.toBe(0)

  await lunaApp.page.getByRole('button', { name: '撤销' }).click()
  await expect(control.locator('input.workspace-param-value-input')).toHaveValue('0')
  expect(lunaApp.runtimeErrors).toEqual([])
})
