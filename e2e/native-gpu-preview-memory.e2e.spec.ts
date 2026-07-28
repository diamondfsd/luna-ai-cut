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
    '-t', '4',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ])
}

test('Windows GPU 预览切换素材和暂停时内存保持有界', async ({ lunaApp }, testInfo) => {
  test.skip(process.platform !== 'win32', '验证 Windows 原生预览资源生命周期')

  const videoA = path.join(lunaApp.temporaryRoot, 'gpu-preview-a.mp4')
  const videoB = path.join(lunaApp.temporaryRoot, 'gpu-preview-b.mp4')
  await Promise.all([
    createVideo(videoA, 'testsrc2'),
    createVideo(videoB, 'smptebars'),
  ])

  await lunaApp.page.evaluate(async ({ first, second }) => {
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
    await api.workspace.createProject('GPU preview memory test', [
      { id: 'preview-a', name: 'gpu-preview-a.mp4', path: first, kind: 'video' },
      { id: 'preview-b', name: 'gpu-preview-b.mp4', path: second, kind: 'video' },
    ])
  }, { first: videoA, second: videoB })

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => {
    window.location.hash = '#/workspace'
  })
  await lunaApp.page.locator('.workspace-project-open').filter({
    hasText: 'GPU preview memory test',
  }).click()

  const preview = lunaApp.page.locator('canvas.native-gpu-video-preview')
  const thumbs = lunaApp.page.locator('.workspace-thumb')
  const playback = lunaApp.page.locator('.ui-video-controls-button')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(thumbs).toHaveCount(2)
  await expect(playback).toBeVisible()

  const memorySamples: Array<{ label: string; privateKb: number; workingSetKb: number }> = []
  const sampleMemory = async (label: string) => {
    const memory = await lunaApp.app.evaluate(({ app }) => {
      const metrics = app.getAppMetrics()
      return metrics.reduce((total, metric) => ({
        privateKb: total.privateKb + metric.memory.privateBytes,
        workingSetKb: total.workingSetKb + metric.memory.workingSetSize,
      }), { privateKb: 0, workingSetKb: 0 })
    })
    memorySamples.push({ label, ...memory })
  }

  await playback.click()
  await lunaApp.page.waitForTimeout(800)
  await playback.click()
  await expect.poll(() => lunaApp.page.evaluate(() => performance.now())).toBeGreaterThan(0)
  await sampleMemory('warm-a')

  const cycleCount = Number.parseInt(process.env.LUNA_GPU_PREVIEW_CYCLES ?? '8', 10)
  for (let cycle = 0; cycle < cycleCount; cycle += 1) {
    const index = (cycle + 1) % 2
    await thumbs.nth(index).click()
    await expect(thumbs.nth(index)).toHaveClass(/active/)
    await expect(preview).toBeVisible()
    await playback.click()
    await lunaApp.page.waitForTimeout(500)
    await playback.click()
    await expect.poll(() => lunaApp.page.evaluate(() => performance.now())).toBeGreaterThan(0)
    await sampleMemory(`cycle-${cycle + 1}-${index === 0 ? 'a' : 'b'}`)
  }

  await testInfo.attach('memory-samples.json', {
    body: Buffer.from(JSON.stringify(memorySamples, null, 2)),
    contentType: 'application/json',
  })
  const baseline = memorySamples[0].privateKb
  const final = memorySamples.at(-1)?.privateKb ?? baseline
  const recentSamples = memorySamples.slice(-Math.min(4, memorySamples.length))
  const recentGrowth = recentSamples.length >= 4 && recentSamples
    .every((sample, index, samples) => index === 0 || sample.privateKb > samples[index - 1].privateKb)
  expect(final - baseline).toBeLessThan(600 * 1024)
  expect(recentGrowth).toBe(false)
  expect(lunaApp.runtimeErrors).toEqual([])
})
