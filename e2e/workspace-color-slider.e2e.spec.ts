import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('workspace color slider keeps its value after dragging', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('ffmpeg test fixture unavailable')

  const videoPath = path.join(lunaApp.temporaryRoot, 'color-slider.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24',
    '-t', '1',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])

  const projectName = `color slider ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, sourcePath }) => {
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

  const control = lunaApp.page.locator('.workspace-param-slider').nth(2)
  const slider = control.locator('.workspace-slider-root')
  await expect(slider.locator('[role="slider"]')).toHaveAttribute('aria-valuenow', '0')
  const box = await slider.boundingBox()
  if (!box) throw new Error('color slider is not laid out')

  const canvasSignature = async (): Promise<number> => lunaApp.page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.preview-canvas-wrapper canvas')
    if (!canvas || canvas.width === 0 || canvas.height === 0) return 0
    const context = canvas.getContext('2d')
    if (!context) return 0
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let total = 0
    for (let index = 0; index < data.length; index += 16) total += data[index] + data[index + 1] + data[index + 2]
    return total
  })
  const originalSignature = await canvasSignature()

  await lunaApp.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await lunaApp.page.mouse.down()
  const handle = slider.locator('[role="slider"]')
  await lunaApp.page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2)

  const draggedValue = await handle.getAttribute('aria-valuenow')
  expect(Number(draggedValue)).not.toBe(0)
  await lunaApp.page.waitForTimeout(100)
  await expect(handle).not.toHaveAttribute('aria-valuenow', '0')
  await expect.poll(canvasSignature).not.toBe(originalSignature)

  await lunaApp.page.mouse.up()

  await expect(handle).not.toHaveAttribute('aria-valuenow', '0')
  await expect(control.locator('input.workspace-param-value-input')).not.toHaveValue('0')

  await lunaApp.page.waitForTimeout(800)
  const savedExposure = await lunaApp.page.evaluate(async (name) => {
    const project = (await window.luna.workspace.listProjects()).find((item) => item.name === name)
    return project?.assets[0]?.pipeline?.color?.exposure ?? 0
  }, projectName)
  expect(savedExposure).not.toBe(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
