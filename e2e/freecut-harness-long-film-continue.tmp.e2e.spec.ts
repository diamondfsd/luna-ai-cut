import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'KbZeoE0r'
const mediaId = '6cfceb8c-e5fc-49b7-921f-2aedfeb4ece8'

interface StoredItem {
  id: string
  type: string
  from?: number
  durationInFrames?: number
  mediaId?: string
  source?: { mediaId?: string }
}

interface StoredProject {
  metadata?: { fps?: number }
  timeline?: { items?: StoredItem[] }
}

async function readProject(projectFile: string): Promise<StoredProject> {
  return JSON.parse(await readFile(projectFile, 'utf8')) as StoredProject
}

function visualItems(project: StoredProject): StoredItem[] {
  return (project.timeline?.items ?? []).filter((item) => item.type === 'video' || item.type === 'image')
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有工作区')
test.setTimeout(90 * 60_000)

test('继续让 Harness 完成长片高光切片', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectFile = path.join(
    settings.baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const toolbarAssistant = page.getByRole('toolbar', { name: '编辑器工具栏' })
    .getByRole('button', { name: 'AI 助手', exact: true })
  await expect(toolbarAssistant).toHaveCount(1)
  await toolbarAssistant.click()
  const assistantPanel = page.locator('aside[aria-label="AI 助手"]')
  console.log('assistant api:', await page.evaluate(() => ({
    hasLuna: 'luna' in window,
    hasHarness: Boolean(window.luna?.deepseekHarness),
    href: window.location.href,
  })))
  if (await assistantPanel.count() === 0) {
    await page.evaluate(async (currentProjectId) => {
      await window.luna.deepseekHarness.openWindow({
        sessionId: crypto.randomUUID(),
        feature: 'freecut-editor',
        projectId: currentProjectId,
      })
    }, projectId)
  }
  await expect(assistantPanel).toBeVisible()
  await expect(assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]'))
    .toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')
  const newSession = harness.getByRole('button', { name: '新建会话', exact: true })
  await expect(newSession).toBeVisible({ timeout: 60_000 })
  await newSession.click()
  const input = harness.locator('textarea:enabled').last()
  await expect(input).toBeVisible({ timeout: 60_000 })

  await input.fill('高压测试   我需要将这个电影 做成切片 利用AI剪辑 /Users/REDACTED/Downloads/大话西游之月光宝盒-1995_BD国粤双语中字.mp4  这个视频很长 你来测试一下看看怎么剪？')
  await input.press('Enter')

  await expect.poll(async () => {
    const project = await readProject(projectFile)
    const visuals = visualItems(project)
    const fps = project.metadata?.fps ?? 30
    const endFrame = Math.max(0, ...visuals.map((item) =>
      (item.from ?? 0) + (item.durationInFrames ?? 0),
    ))
    return {
      ready: visuals.length >= 4 && visuals.length <= 8 && endFrame / fps <= 60,
      count: visuals.length,
      durationSeconds: endFrame / fps,
      onlySource: visuals.length > 0 && visuals.every((item) =>
        item.mediaId === mediaId || item.source?.mediaId === mediaId,
      ),
      validDurations: visuals.length > 0 && visuals.every((item) =>
        (item.durationInFrames ?? 0) > 0,
      ),
    }
  }, { timeout: 85 * 60_000, intervals: [5_000] }).toEqual({
    ready: true,
    count: expect.any(Number),
    durationSeconds: expect.any(Number),
    onlySource: true,
    validDurations: true,
  })

  const project = await readProject(projectFile)
  const visuals = visualItems(project)
  const fps = project.metadata?.fps ?? 30
  const endFrame = Math.max(0, ...visuals.map((item) =>
    (item.from ?? 0) + (item.durationInFrames ?? 0),
  ))
  expect(visuals.length).toBeGreaterThanOrEqual(4)
  expect(visuals.length).toBeLessThanOrEqual(8)
  expect(endFrame / fps).toBeLessThanOrEqual(60)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
})
