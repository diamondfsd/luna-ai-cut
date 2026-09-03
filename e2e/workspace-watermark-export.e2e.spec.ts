import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')

test('exports a local video with the built-in watermark', async ({ lunaApp }) => {
  const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffmpegPath = process.env.FFMPEG_BIN ?? path.join(projectRoot, 'resources', 'ffmpeg', executableName)
  test.skip(!existsSync(ffmpegPath), 'FFmpeg test binary is unavailable')

  const videoPath = path.join(lunaApp.temporaryRoot, 'local-watermark-input.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-t', '1.5',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-an',
    '-movflags', '+faststart',
    '-y', videoPath,
  ])

  const projectName = `local watermark export ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => (
    window.luna.workspace.createProject(name, [{
      id: 'local-watermark-video',
      name: 'local-watermark-input.mp4',
      path: filePath,
      kind: 'video',
      sourceDeviceId: 'luna-ultra',
      sourceDeviceName: 'Luna Ultra',
      cameraType: 'Luna Ultra',
      watermarkProfileId: 'luna-ultra',
    }])
  ), { name: projectName, filePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  const projectButton = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName })
  await expect(projectButton).toBeVisible()
  await projectButton.click()
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })

  const watermarkTool = lunaApp.page.locator('.workspace-tool-rail button[aria-label="水印"]')
  await expect(watermarkTool).toBeVisible()
  await watermarkTool.click()

  const styleControl = lunaApp.page.locator('[aria-label="水印样式"]')
  await expect(styleControl).toBeVisible({ timeout: 30_000 })
  await styleControl.getByRole('button').nth(1).click()

  const exportButton = lunaApp.page.locator('.workspace-toolbar-actions > button').last()
  await expect(exportButton).toBeEnabled()
  await exportButton.click()
  const dialog = lunaApp.page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('.workspace-export-footer-actions > button').last().click()

  await expect.poll(
    async () => (await lunaApp.page.evaluate(async () => (await window.luna.exportTask.list())[0])) ?? null,
    { timeout: 120_000, intervals: [200, 500, 1_000] },
  ).toMatchObject({ status: 'completed' })

  const task = await lunaApp.page.evaluate(async () => (await window.luna.exportTask.list())[0])
  const outputPath = task?.items[0]?.destinationPath
  expect(outputPath).toBeTruthy()
  expect((await stat(outputPath!)).size).toBeGreaterThan(0)

  const nativeLogPath = path.join(lunaApp.temporaryRoot, 'downloads', 'logs', 'luna-rc.log')
  await expect.poll(
    async () => readFile(nativeLogPath, 'utf8').catch(() => ''),
    { timeout: 30_000, intervals: [200, 500, 1_000] },
  ).toContain('[Export:Rust:Video] canvas=640x360 layers=2 kinds=[0:video->video,1:image->static]')

  expect(lunaApp.runtimeErrors).toEqual([])
})
