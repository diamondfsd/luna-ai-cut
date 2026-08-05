import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('工作台打开旧版调色视频时重置参数并正常显示', async ({ lunaApp }) => {
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')
  const videoPath = path.join(lunaApp.temporaryRoot, 'legacy-color-video.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24',
    '-t', '2',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])

  const projectName = `旧版调色 E2E ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, sourcePath }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'legacy-color-video',
      name: 'legacy-color-video.mp4',
      path: sourcePath,
      kind: 'video',
      pipeline: {
        color: {
          exposure: 42,
          brightness: 30,
        },
      },
    }])
  }, { name: projectName, sourcePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 1 个素材`, exact: true }).click()

  await expect(lunaApp.page.getByText('当前素材的旧版调色参数已重置', { exact: true })).toBeVisible()
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible()
  await expect(lunaApp.page.locator('.preview-stage-error')).toHaveCount(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
