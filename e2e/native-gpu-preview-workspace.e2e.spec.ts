import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('工作台 GPU 预览跟随画布并可无错误退出', async ({ lunaApp }) => {
  test.skip(process.platform !== 'win32', '验证 Windows 原生预览窗口生命周期')
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
        saveSettings: (settings: { experimentalGpuPreview: boolean }) => Promise<unknown>
        workspace: {
          createProject: (
            name: string,
            assets: Array<{ id: string; name: string; path: string; kind: 'video' }>,
          ) => Promise<unknown>
        }
      }
    }).luna
    await api.saveSettings({ experimentalGpuPreview: true })
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

  const preview = lunaApp.page.locator('canvas.native-gpu-video-preview')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  const initialBounds = await preview.boundingBox()
  expect(initialBounds).not.toBeNull()

  await lunaApp.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    window?.setSize(1100, 700)
  })
  await expect.poll(async () => {
    const bounds = await preview.boundingBox()
    return bounds ? `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}` : ''
  }).not.toBe(
    initialBounds
      ? `${Math.round(initialBounds.x)},${Math.round(initialBounds.y)},${Math.round(initialBounds.width)},${Math.round(initialBounds.height)}`
      : '',
  )

  await lunaApp.page.getByRole('button', { name: '返回工作台' }).click()
  await expect(preview).toHaveCount(0)
  await lunaApp.page.waitForTimeout(500)

  const appLog = await readFile(
    path.join(lunaApp.temporaryRoot, 'artifacts', 'app.log'),
    'utf8',
  )
  expect(appLog).not.toContain("Error occurred in handler for 'lrc:updateNativePreviewComposition'")
  expect(lunaApp.runtimeErrors).toEqual([])
})
