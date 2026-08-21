import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'KbZeoE0r'
const mediaId = '6cfceb8c-e5fc-49b7-921f-2aedfeb4ece8'

test.setTimeout(45 * 60_000)

test('长片 AI 分析不会按 3 秒生成无限视觉样本', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const mediaFile = path.join(settings.baseDir, 'freecut-workspace', 'media', mediaId, 'metadata.json')

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const mediaName = '大话西游之月光宝盒-1995_BD国粤双语中字.mp4'
  const mediaTitle = page.getByText(mediaName, { exact: true }).first()
  await expect(mediaTitle).toBeVisible({ timeout: 30_000 })
  await mediaTitle.locator('..').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '使用 AI 分析', exact: true }).click()

  await expect.poll(async () => {
    const metadata = JSON.parse(await readFile(mediaFile, 'utf8')) as {
      aiCaptions?: Array<{ timeSec: number }>
    }
    return metadata.aiCaptions?.length ?? 0
  }, { timeout: 45 * 60_000 }).toBeGreaterThan(0)

  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
})
