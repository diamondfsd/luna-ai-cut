import { createHash } from 'node:crypto'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'J4ANiM2O'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会读取现有项目')

test('最终 AI 成片的四个镜头预览帧非空且互不相同', async ({ lunaLiveApp }, testInfo) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const monitor = page.locator('[aria-label="Program monitor"]')
  await expect(monitor).toBeVisible()
  await monitor.click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('Home')

  const hashes: string[] = []
  const sampleFrames = [30, 105, 255, 450]
  let currentFrame = 0
  for (const frame of sampleFrames) {
    for (; currentFrame < frame; currentFrame += 1) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    const outputPath = testInfo.outputPath(`preview-frame-${frame}.png`)
    const screenshot = await monitor.screenshot({ path: outputPath })
    expect(screenshot.byteLength).toBeGreaterThan(5_000)
    hashes.push(createHash('sha256').update(screenshot).digest('hex'))
    await testInfo.attach(`preview-frame-${frame}.png`, { path: outputPath, contentType: 'image/png' })
  }

  expect(new Set(hashes).size).toBe(4)
  expect(runtimeErrors).toEqual([])
})
