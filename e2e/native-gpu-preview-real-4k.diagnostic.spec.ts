import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const PROJECT_PATH = 'C:\\Users\\diamond\\Pictures\\LunaAI-Cut\\workspace-projects\\2026-07-11T15-58-37-554Z-1\\project.json'
const MEMORY_ABORT_DELTA_KB = 1024 * 1024
const MEMORY_SAMPLE_INTERVAL_MS = 250
const VIDEO_LIMIT = Number.parseInt(process.env.LUNA_REAL_4K_VIDEO_LIMIT ?? '', 10)

test('真实工作空间 4K 视频切换和暂停恢复内存采样', async ({ lunaApp }, testInfo) => {
  test.skip(process.platform !== 'win32', '验证 Windows WebGPU 预览')
  test.setTimeout(240_000)
  const progressPath = path.join(lunaApp.temporaryRoot, 'artifacts', 'real-4k-progress.json')
  const recordProgress = async (stage: string) => {
    await writeFile(progressPath, JSON.stringify({ stage, updatedAt: new Date().toISOString() }), 'utf8')
  }
  await recordProgress('reading-project')

  const sourceProject = JSON.parse(await readFile(PROJECT_PATH, 'utf8')) as {
    assets: Array<{
      id: string
      name: string
      path: string
      kind: 'video' | 'image'
      pipeline?: unknown
    }>
  }
  const availableVideos = sourceProject.assets.filter((asset) => asset.kind === 'video')
  const sourceVideos = Number.isFinite(VIDEO_LIMIT)
    ? availableVideos.slice(0, Math.max(1, VIDEO_LIMIT))
    : availableVideos
  if (sourceVideos.length === 0) throw new Error('真实工作空间中没有 4K 视频')

  await lunaApp.page.evaluate(async (assets) => {
    const api = (window as typeof window & {
      luna: {
        workspace: {
          createProject: (
            name: string,
            assets: Array<{ id: string; name: string; path: string; kind: 'video' }>,
          ) => Promise<{ assets: Array<{ pipeline?: unknown }> }>
          saveProject: (project: unknown) => Promise<unknown>
        }
      }
    }).luna
    const project = await api.workspace.createProject(
      '真实 4K GPU 预览诊断',
      assets.map(({ id, name, path: sourcePath }) => ({
        id,
        name,
        path: sourcePath,
        kind: 'video',
      })),
    )
    project.assets.forEach((asset, index) => {
      asset.pipeline = assets[index]?.pipeline
    })
    await api.workspace.saveProject(project)
  }, sourceVideos)

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.evaluate(() => {
    window.location.hash = '#/workspace'
  })
  await lunaApp.page.locator('.workspace-project-open').filter({
    hasText: '真实 4K GPU 预览诊断',
  }).click()
  await recordProgress('project-opened-waiting-for-wgpu')

  const preview = lunaApp.page.locator('canvas[data-renderer="webgpu"]')
  const loading = lunaApp.page.locator('.preview-loading-overlay')
  const playback = lunaApp.page.locator('.ui-video-controls-button')
  const progress = lunaApp.page.getByRole('slider', { name: '视频进度' })
  const progressRoot = lunaApp.page.locator('.ui-video-controls-progress')
  const thumbs = lunaApp.page.locator('.workspace-thumb')
  await expect(preview).toBeVisible({ timeout: 120_000 })
  await expect(playback).toBeVisible({ timeout: 120_000 })
  await expect(progress).toBeEnabled({ timeout: 120_000 })
  await expect(thumbs).toHaveCount(sourceVideos.length)
  await expect(loading).toBeVisible({ timeout: 120_000 })
  await expect(loading).toBeHidden({ timeout: 120_000 })
  await recordProgress('first-frame-presented')

  const samplesPath = path.join(
    lunaApp.temporaryRoot,
    'artifacts',
    'real-4k-memory-samples.json',
  )
  const memorySamples: Array<{
    label: string
    privateKb: number
    workingSetKb: number
    processes: Array<{
      pid: number
      type: string
      privateKb: number
      workingSetKb: number
    }>
  }> = []
  const sampleMemory = async (label: string) => {
    const memory = await lunaApp.app.evaluate(({ app }) => {
      const processes = app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        privateKb: metric.memory.privateBytes,
        workingSetKb: metric.memory.workingSetSize,
      }))
      return {
        privateKb: processes.reduce((sum, process) => sum + process.privateKb, 0),
        workingSetKb: processes.reduce((sum, process) => sum + process.workingSetKb, 0),
        processes,
      }
    })
    memorySamples.push({ label, ...memory })
    await writeFile(samplesPath, JSON.stringify(memorySamples, null, 2), 'utf8')
    const baseline = memorySamples[0]
    if (baseline && memory.privateKb - baseline.privateKb > MEMORY_ABORT_DELTA_KB) {
      throw new Error(
        `GPU 预览内存增长过快，已中止测试：${Math.round(
          (memory.privateKb - baseline.privateKb) / 1024,
        )} MB`,
      )
    }
  }
  const monitorPlayback = async (label: string, durationMs: number) => {
    for (let elapsed = MEMORY_SAMPLE_INTERVAL_MS; elapsed <= durationMs; elapsed += MEMORY_SAMPLE_INTERVAL_MS) {
      await lunaApp.page.waitForTimeout(MEMORY_SAMPLE_INTERVAL_MS)
      await sampleMemory(`${label}-${elapsed}ms`)
    }
  }
  const seekByRatio = async (label: string, ratio: number) => {
    const max = Number(await progress.getAttribute('aria-valuemax'))
    const bounds = await progressRoot.boundingBox()
    if (!Number.isFinite(max) || max <= 1 || !bounds) {
      throw new Error('视频进度暂时无法操作')
    }
    await progressRoot.click({
      position: {
        x: Math.max(1, Math.min(bounds.width - 1, bounds.width * ratio)),
        y: bounds.height / 2,
      },
    })
    await expect.poll(async () => {
      const value = Number(await progress.getAttribute('aria-valuenow'))
      return Math.abs(value - max * ratio)
    }, { timeout: 25_000 }).toBeLessThan(Math.max(1, max * 0.05))
    await expect(loading).toBeHidden({ timeout: 25_000 })
    await sampleMemory(label)
  }

  try {
    await sampleMemory('ready')
    for (let index = 0; index < sourceVideos.length; index += 1) {
      const video = sourceVideos[index]
      await recordProgress(`video-${index + 1}-start-${video.name}`)
      if (index > 0) {
        await thumbs.nth(index).click()
        await expect(thumbs.nth(index)).toHaveClass(/active/)
        await expect(loading).toBeVisible({ timeout: 10_000 })
        await expect(loading).toBeHidden({ timeout: 25_000 })
        await expect(preview).toBeVisible()
        await sampleMemory(`switched-${index + 1}-${video.name}`)
        await recordProgress(`video-${index + 1}-switched-${video.name}`)
      }

      await playback.click()
      await expect(playback).toHaveAttribute('aria-label', '暂停')
      await monitorPlayback(`playing-${index + 1}-${video.name}`, 2_000)

      await playback.click()
      await expect(playback).toHaveAttribute('aria-label', '播放')
      await lunaApp.page.waitForTimeout(1_000)
      await sampleMemory(`paused-${index + 1}-${video.name}`)
      await seekByRatio(`seek-paused-${index + 1}-${video.name}`, 0.65)
      await expect(playback).toHaveAttribute('aria-label', '播放')

      await playback.click()
      await expect(playback).toHaveAttribute('aria-label', '暂停')
      await monitorPlayback(`resumed-${index + 1}-${video.name}`, 1_000)
      await seekByRatio(`seek-playing-${index + 1}-${video.name}`, 0.2)
      await expect(playback).toHaveAttribute('aria-label', '暂停', { timeout: 25_000 })
      await monitorPlayback(`playing-after-seek-${index + 1}-${video.name}`, 750)

      await playback.click()
      await expect(playback).toHaveAttribute('aria-label', '播放')
      await recordProgress(`video-${index + 1}-completed-${video.name}`)
    }
  } finally {
    await testInfo.attach('real-4k-memory-samples.json', {
      body: Buffer.from(JSON.stringify(memorySamples, null, 2)),
      contentType: 'application/json',
    })
  }

  const baseline = memorySamples[0]
  const final = memorySamples.at(-1) ?? baseline
  const peak = Math.max(...memorySamples.map((sample) => sample.privateKb))
  expect(final.privateKb - baseline.privateKb).toBeLessThan(500 * 1024)
  expect(peak - baseline.privateKb).toBeLessThan(800 * 1024)
  const appLog = await readFile(path.join(lunaApp.temporaryRoot, 'artifacts', 'app.log'), 'utf8')
  expect(appLog).not.toContain('ERROR: [NativePreview] render')
  expect(lunaApp.runtimeErrors).toEqual([])
})
