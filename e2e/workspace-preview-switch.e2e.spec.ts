import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

async function createVideo(outputPath: string, pattern: string): Promise<void> {
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', `${pattern}=size=3840x2160:rate=30`,
    '-t', '3',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ])
}

test('工作台切换视频素材后预览 loading 能正常结束', async ({ lunaApp }) => {
  test.setTimeout(90_000)
  const firstVideo = path.join(lunaApp.temporaryRoot, 'preview-switch-first.mp4')
  const secondVideo = path.join(lunaApp.temporaryRoot, 'preview-switch-second.mp4')
  await Promise.all([
    createVideo(firstVideo, 'testsrc2'),
    createVideo(secondVideo, 'smptebars'),
  ])

  const projectName = `预览切换 E2E ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, first, second }) => (
    window.luna.workspace.createProject(name, [
      { id: 'preview-switch-first', name: 'preview-switch-first.mp4', path: first, kind: 'video' },
      { id: 'preview-switch-second', name: 'preview-switch-second.mp4', path: second, kind: 'video' },
    ])
  ), { name: projectName, first: firstVideo, second: secondVideo })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 2 个素材`, exact: true }).click()

  const thumbs = lunaApp.page.locator('.workspace-thumb')
  const loading = lunaApp.page.locator('.preview-loading-overlay')
  await expect(thumbs).toHaveCount(2)
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })

  await thumbs.nth(1).click()
  await expect(thumbs.nth(1)).toHaveClass(/active/)
  await expect(loading).toBeHidden({ timeout: 8_000 })

  await thumbs.nth(0).click()
  await expect(thumbs.nth(0)).toHaveClass(/active/)
  await expect(loading).toBeHidden({ timeout: 8_000 })
  expect(lunaApp.runtimeErrors).toEqual([])
})
