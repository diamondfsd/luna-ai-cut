import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('Windows 暂停使用 GPU 预览', async ({ lunaApp }) => {
  test.skip(process.platform !== 'win32', '验证 Windows GPU 预览禁用策略')
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-native-preview.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=960x540:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '3',
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
    window.location.hash = '#/settings'
  })
  await expect(lunaApp.page.getByRole('switch', { name: '加速预览' })).toBeVisible()

  await lunaApp.page.evaluate(() => {
    window.location.hash = '#/workspace'
  })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: 'GPU 预览 E2E' })
  await expect(project).toBeVisible()
  await project.click()

  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })
  await expect(lunaApp.page.locator('canvas.native-gpu-video-preview')).toBeVisible()

  const playback = lunaApp.page.locator('.ui-video-controls-button')
  await expect(playback).toHaveAttribute('aria-label', '播放')
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', '暂停')
  await lunaApp.page.waitForTimeout(300)
  await playback.click()
  await expect(playback).toHaveAttribute('aria-label', '播放')
  await lunaApp.page.waitForTimeout(800)
  await expect(playback).toHaveAttribute('aria-label', '播放')

  await lunaApp.page.getByRole('button', { name: '返回工作台' }).click()
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toHaveCount(0)
  await lunaApp.page.waitForTimeout(500)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('Windows GPU preview allows top-level navigation while playing', async ({ lunaApp }) => {
  test.skip(process.platform !== 'win32', 'Windows GPU preview regression test')
  if (!ffmpegPath) throw new Error('ffmpeg test fixture unavailable')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-route-switch.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=960x540:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '3',
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
    await api.workspace.createProject('GPU route switch E2E', [{
      id: 'gpu-route-switch-video',
      name: 'workspace-route-switch.mp4',
      path: sourcePath,
      kind: 'video',
    }])
  }, videoPath)

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  await lunaApp.page.locator('.workspace-project-open').filter({ hasText: 'GPU route switch E2E' }).click()
  await expect(lunaApp.page.locator('canvas.native-gpu-video-preview')).toBeVisible({ timeout: 30_000 })

  const playback = lunaApp.page.locator('.ui-video-controls-button')
  const stoppedLabel = await playback.getAttribute('aria-label')
  await playback.click()
  await expect(playback).not.toHaveAttribute('aria-label', stoppedLabel!)

  await lunaApp.page.locator('a[href="#/settings"]').click()
  await expect(lunaApp.page).toHaveURL(/#\/settings$/)

  await lunaApp.page.locator('a[href="#/local-resources"]').click()
  await expect(lunaApp.page).toHaveURL(/#\/local-resources$/)
  expect(lunaApp.runtimeErrors).toEqual([])
})
