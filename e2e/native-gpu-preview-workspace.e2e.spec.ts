import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('Windows 工作台预览使用 WebGPU 且可以返回项目列表', async ({ lunaApp }) => {
  test.skip(process.platform !== 'win32', '验证 Windows WebGPU 工作台预览')
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-native-preview.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=960x540:rate=30',
    '-t', '3',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])

  await lunaApp.page.evaluate(async (sourcePath) => {
    const api = (window as typeof window & {
      luna: {
        workspace: {
          createProject: (
            name: string,
            assets: Array<{ id: string; name: string; path: string; kind: 'video' }>,
          ) => Promise<unknown>
        }
      }
    }).luna
    await api.workspace.createProject('GPU 预览 E2E', [{
      id: 'gpu-preview-video',
      name: 'workspace-native-preview.mp4',
      path: sourcePath,
      kind: 'video',
    }])
  }, videoPath)
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')

  await lunaApp.page.evaluate(() => {
    window.location.hash = '#/workspace'
  })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: 'GPU 预览 E2E' })
  await expect(project).toBeVisible()
  await project.click()

  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas[data-renderer="webgpu"]')).toBeVisible({ timeout: 30_000 })
  await expect(lunaApp.page.locator('canvas.native-gpu-video-preview')).toHaveCount(0)

  await lunaApp.page.getByRole('button', { name: '返回工作台' }).click()
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toHaveCount(0)
  await lunaApp.page.waitForTimeout(500)
  expect(lunaApp.runtimeErrors).toEqual([])
})
