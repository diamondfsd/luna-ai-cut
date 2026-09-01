import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)

test('工作台 Live 图缩略图播放按钮驱动左侧预览', async ({ lunaApp }) => {
  test.setTimeout(90_000)
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-trim-live-playback.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-t', '8',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y',
    videoPath,
  ])

  const projectName = `Live 图缩略图播放 ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'workspace-trim-live-playback-video',
      name: 'workspace-trim-live-playback.mp4',
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  const project = lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName })
  await expect(project).toBeVisible()
  await project.click()
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })

  await lunaApp.page.getByRole('button', { name: '截取', exact: true }).click()
  const addLiveButton = lunaApp.page.getByRole('button', { name: 'Live 图', exact: true })
  await expect(addLiveButton).toBeEnabled({ timeout: 10_000 })
  await addLiveButton.click()

  const thumbnailVideo = lunaApp.page.locator('.workspace-trim-marker-thumbnail video')
  await lunaApp.page.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('.workspace-trim-marker-thumbnail video')
    return Boolean(video && video.readyState >= 1)
  })
  const playButton = lunaApp.page.locator('.workspace-trim-live-play-overlay')
  await playButton.click()
  await expect(playButton).toHaveAttribute('aria-label', '暂停Live 图预览')
  await expect(lunaApp.page.locator('.workspace-trim-play-btn')).toHaveAttribute('aria-label', '暂停')
  await expect(thumbnailVideo).toHaveJSProperty('paused', true)

  await playButton.click()
  await expect(playButton).toHaveAttribute('aria-label', '播放Live 图')
  await expect(lunaApp.page.locator('.workspace-trim-play-btn')).toHaveAttribute('aria-label', '播放')
  await playButton.click()
  await expect(playButton).toHaveAttribute('aria-label', '暂停Live 图预览')
  await expect(lunaApp.page.locator('.workspace-trim-play-btn')).toHaveAttribute('aria-label', '暂停')

  // 源视频明显长于默认 3 秒的 Live 片段，避免误把源视频自然结束当成范围限制。
  await lunaApp.page.waitForTimeout(3_300)
  await expect(playButton).toHaveAttribute('aria-label', '播放Live 图', { timeout: 5_000 })
  await expect(lunaApp.page.locator('.workspace-trim-play-btn')).toHaveAttribute('aria-label', '播放')
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('工作台拖动左侧 Live 胶囊后切回截取仍保留 Live 图', async ({ lunaApp }) => {
  test.setTimeout(90_000)
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')

  const videoPath = path.join(lunaApp.temporaryRoot, 'workspace-trim-live-drag.mp4')
  await execFileAsync(ffmpegPath, [
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30',
    '-t', '8',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y', videoPath,
  ])

  const projectName = `Live 图拖动 ${Date.now()}`
  await lunaApp.page.evaluate(async ({ name, filePath }) => {
    await window.luna.workspace.createProject(name, [{
      id: 'workspace-trim-live-drag-video',
      name: 'workspace-trim-live-drag.mp4',
      path: filePath,
      kind: 'video',
    }])
  }, { name: projectName, filePath: videoPath })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => { window.location.hash = '#/workspace' })

  await lunaApp.page.locator('.workspace-project-open').filter({ hasText: projectName }).click()
  await expect(lunaApp.page.locator('.preview-canvas-wrapper canvas')).toBeVisible({ timeout: 30_000 })
  await lunaApp.page.getByRole('button', { name: '截取', exact: true }).click()

  const addLiveButton = lunaApp.page.getByRole('button', { name: 'Live 图', exact: true })
  await expect(addLiveButton).toBeEnabled({ timeout: 10_000 })
  await addLiveButton.click()

  const markerList = lunaApp.page.locator('.workspace-trim-marker-list')
  await expect(markerList.locator('.workspace-trim-marker-row')).toHaveCount(1)
  const liveRange = lunaApp.page.locator('.workspace-trim-secondary-range')
  await expect(liveRange).toBeVisible()

  const before = await liveRange.boundingBox()
  if (!before) throw new Error('Live 胶囊没有可用位置')
  await lunaApp.page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await lunaApp.page.mouse.down()
  await lunaApp.page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2)
  await lunaApp.page.mouse.up()

  await lunaApp.page.getByRole('button', { name: '滤镜', exact: true }).click()
  await expect(markerList).toHaveCount(0)
  await lunaApp.page.getByRole('button', { name: '截取', exact: true }).click()

  await expect(lunaApp.page.locator('.workspace-trim-marker-list .workspace-trim-marker-row')).toHaveCount(1)
  await expect(lunaApp.page.locator('.workspace-trim-secondary-range')).toBeVisible()
  expect(lunaApp.runtimeErrors).toEqual([])
})
