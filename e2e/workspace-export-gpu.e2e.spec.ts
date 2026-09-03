import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('workspace export uses Windows GPU pipeline after an edit', async ({ lunaApp }) => {
  test.skip(process.platform !== 'win32', 'Windows GPU export verification')
  if (!ffmpegPath) throw new Error('ffmpeg is unavailable')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-export-gpu.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '2',
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

  const projectName = `workspace export GPU ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'workspace-export-gpu-video',
      name: 'workspace-export-gpu.mp4',
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

  await lunaApp.page.locator('.workspace-tool-rail button').first().click()
  const exposureSlider = lunaApp.page.locator('.workspace-color-modules [role="slider"]').first()
  await expect(exposureSlider).toBeVisible()
  const beforeExposure = await exposureSlider.getAttribute('aria-valuenow')
  await exposureSlider.press('ArrowRight')
  await expect.poll(() => exposureSlider.getAttribute('aria-valuenow')).not.toBe(beforeExposure)

  const exportButton = lunaApp.page.locator('.workspace-toolbar-actions > button').last()
  await expect(exportButton).toBeEnabled()
  await exportButton.click()

  const dialog = lunaApp.page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('.workspace-export-footer-actions > button').last().click()

  await expect.poll(
    async () => lunaApp.page.evaluate(async () => (await window.luna.exportTask.list())[0]?.status ?? 'missing'),
    { timeout: 120_000, intervals: [200, 500, 1_000] },
  ).toBe('completed')

  const task = await lunaApp.page.evaluate(async () => (await window.luna.exportTask.list())[0])
  const outputPath = task?.items[0]?.destinationPath
  expect(task?.items[0]?.status).toBe('done')
  expect(outputPath).toBeTruthy()
  const outputStat = await stat(outputPath!)
  expect(outputStat.size).toBeGreaterThan(0)

  const nativeLogPath = path.join(lunaApp.temporaryRoot, 'downloads', 'logs', 'luna-rc.log')
  await expect.poll(
    async () => readFile(nativeLogPath, 'utf8').catch(() => ''),
    { timeout: 30_000, intervals: [200, 500, 1_000] },
  ).toContain('[Export:WinGPU] completed')
  const nativeLog = await readFile(nativeLogPath, 'utf8')
  const exportEvidence = nativeLog
    .split(/\r?\n/)
    .filter((line) => line.includes('[Export:WinGPU]') || line.includes('[Export:FFmpeg]'))
  console.log(`Windows export evidence:\n${exportEvidence.slice(-20).join('\n')}`)
  expect(nativeLog).toContain('[Export:WinGPU] selecting compatible hardware path')
  expect(nativeLog).toContain('decoder=media-foundation')
  expect(nativeLog).toContain('compositor=wgpu')
  expect(nativeLog).toMatch(/encoder=h264_(qsv|nvenc|amf)/)
  expect(nativeLog).toContain('transport=cpu-readback')
  expect(nativeLog).toMatch(/\[Export:WinGPU:Timing\] compatible summary frames=60 total_ms=\d+/)
  expect(nativeLog).toContain('[Export:WinGPU] completed')
  expect(nativeLog).not.toContain('[Export:WinGPU] unavailable')
  expect(nativeLog).not.toContain('[Export:FFmpeg] fallback')
  expect(lunaApp.runtimeErrors).toEqual([])
})
