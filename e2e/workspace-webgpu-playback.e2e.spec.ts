import { existsSync } from 'node:fs'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const videoPath = process.env.LUNA_E2E_VIDEO_PATH

test('Windows workspace video preview advances after replaying from the beginning', async ({ lunaApp }, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows-specific video preview regression coverage')
  test.skip(!videoPath || !existsSync(videoPath), 'Set LUNA_E2E_VIDEO_PATH to a local video file')
  if (!videoPath) return

  const projectName = `WebGPU playback ${Date.now()}`
  const fileName = path.basename(videoPath)
  await lunaApp.page.evaluate(async ({ name, filePath, fileName }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'workspace-webgpu-playback-video',
      name: fileName,
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath, fileName })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  await lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName }).click()
  const stage = lunaApp.page.locator('.preview-canvas-wrapper canvas')
  await expect(stage).toBeVisible({ timeout: 30_000 })

  const previewStage = lunaApp.page.locator('.preview-stage')
  const playButton = previewStage.getByRole('button', { name: '播放' })
  await expect(playButton).toBeEnabled({ timeout: 15_000 })
  const playbackTime = previewStage.locator('.ui-video-controls-time')
  const progress = previewStage.getByRole('slider', { name: '视频进度' })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await playButton.click()
    await expect(previewStage.getByRole('button', { name: '暂停' })).toBeVisible()
    await expect.poll(async () => {
      const text = await playbackTime.textContent()
      const [minutes, seconds] = text?.split(' / ')[0]?.split(':').map(Number) ?? []
      return (minutes ?? 0) * 60 + (seconds ?? 0)
    }).toBeGreaterThan(0)

    await previewStage.getByRole('button', { name: '暂停' }).click()
    if (attempt < 2) {
      await progress.press('Home')
      await expect(playbackTime).toContainText('0:00')
    }
  }

  await stage.screenshot({ path: testInfo.outputPath('windows-webgpu-first-second.png') })
  expect(lunaApp.runtimeErrors).toEqual([])
})
