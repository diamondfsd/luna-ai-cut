import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('workspace video stops at the end and can be paused', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('ffmpeg test fixture unavailable')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-playback.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '1.2',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])

  const projectName = `workspace playback ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'workspace-playback-video',
      name: 'workspace-playback.mp4',
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => {
    window.location.hash = '#/workspace'
  })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName })
  await expect(project).toBeVisible()
  await project.click()

  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })
  const playback = lunaApp.page.locator('.ui-video-controls-button')
  const stoppedLabel = await playback.getAttribute('aria-label')
  expect(stoppedLabel).toBeTruthy()

  await playback.click()
  await expect(playback).not.toHaveAttribute('aria-label', stoppedLabel!)
  await lunaApp.page.waitForTimeout(150)
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', stoppedLabel!)
  await lunaApp.page.waitForTimeout(500)
  await expect(playback).toHaveAttribute('aria-label', stoppedLabel!)

  await playback.click()
  await expect(playback).not.toHaveAttribute('aria-label', stoppedLabel!)
  await lunaApp.page.waitForTimeout(1_800)
  await expect(playback).toHaveAttribute('aria-label', stoppedLabel!)
  expect(lunaApp.runtimeErrors).toEqual([])
})
