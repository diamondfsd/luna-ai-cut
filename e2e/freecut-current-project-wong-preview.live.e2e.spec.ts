import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'MShH08dL'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会读取现有项目')
test.setTimeout(3 * 60_000)

interface ProjectFile {
  fps?: number
  metadata?: { fps?: number }
  timeline?: { items?: Array<{ type: string; from: number; durationInFrames: number }> }
}

test('用应用寻帧接口导出暗部效果预览帧', async ({ lunaLiveApp }, testInfo) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectFile = path.join(
    settings.baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )
  const project = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
  const visuals = (project.timeline?.items ?? []).filter((item) => item.type === 'video' || item.type === 'image')
  const endFrame = Math.max(...visuals.map((item) => item.from + item.durationInFrames))
  const fps = project.metadata?.fps ?? project.fps ?? 30

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const monitor = page.getByLabel('Program monitor')
  const canvasRegion = monitor.getByLabel('Preview canvas region')
  await expect(canvasRegion).toBeVisible()
  const sampleFrames = [...new Set([
    0,
    Math.max(1, Math.floor(endFrame * 0.25)),
    Math.max(1, Math.floor(endFrame * 0.6)),
    Math.max(1, endFrame - 1),
  ])]
  const hashes: string[] = []
  const outputs: string[] = []
  const goToStart = monitor.getByRole('button', { name: '跳到开始' })
  const nextFrame = monitor.getByRole('button', { name: '下一帧' })
  await goToStart.click()
  let currentFrame = 0

  for (const frame of sampleFrames) {
    for (; currentFrame < frame; currentFrame += 1) {
      await nextFrame.click()
      if (currentFrame % 8 === 0) await page.waitForTimeout(20)
    }
    await page.waitForTimeout(1_500)

    const outputPath = testInfo.outputPath(`wong-effects-preview-${frame}-${(frame / fps).toFixed(2)}s.png`)
    const screenshot = await canvasRegion.screenshot({ path: outputPath })
    expect(screenshot.byteLength).toBeGreaterThan(5_000)
    hashes.push(createHash('sha256').update(screenshot).digest('hex'))
    outputs.push(outputPath)
    await testInfo.attach(path.basename(outputPath), { path: outputPath, contentType: 'image/png' })
  }

  console.log(`WONG_EFFECT_CANVAS_PREVIEWS ${JSON.stringify({ projectId, endFrame, fps, outputs, hashes })}`)
  expect(new Set(hashes).size).toBeGreaterThan(1)
  expect(runtimeErrors).toEqual([])
})
