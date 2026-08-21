import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'KbZeoE0r'
const mediaId = '6cfceb8c-e5fc-49b7-921f-2aedfeb4ece8'
const mediaName = '大话西游之月光宝盒-1995_BD国粤双语中字.mp4'

interface StoredItem {
  id: string
  type: string
  from?: number
  durationInFrames?: number
  mediaId?: string
  source?: { mediaId?: string }
}

interface StoredProject {
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

test('Harness 直接尝试把长电影剪成可验证的切片', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectFile = path.join(
    settings.baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )
  const mediaFile = path.join(
    settings.baseDir,
    'freecut-workspace',
    'media',
    mediaId,
    'metadata.json',
  )

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  await expect(page.getByText(mediaName, { exact: true }).first()).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistantPanel).toBeVisible()
  const harnessFrame = assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(harnessFrame).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')
  const input = harness.locator('textarea:enabled').last()
  await expect(input).toBeVisible({ timeout: 60_000 })

  const turns = [
    '高压测试   我需要将这个电影 做成切片 利用AI剪辑 /Users/REDACTED/Downloads/大话西游之月光宝盒-1995_BD国粤双语中字.mp4  这个视频很长 你来测试一下看看怎么剪？',
    '继续吧',
    '？ 你不是应该让harness进行 尝试剪辑吗  不是你自己分析哦',
  ]

  for (const turn of turns) {
    await expect(input).toBeEnabled({ timeout: 15 * 60_000 })
    await input.fill(turn)
    await input.press('Enter')
    await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
    await expect(input).toBeEnabled({ timeout: 60 * 60_000 })
    await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  }

  await expect.poll(async () => {
    const project = await readProject(projectFile)
    return visualItems(project).length
  }, { timeout: 20 * 60_000 }).toBeGreaterThan(0)

  const project = await readProject(projectFile)
  const visuals = visualItems(project)
  const metadata = JSON.parse(await readFile(mediaFile, 'utf8')) as {
    aiCaptions?: Array<{ timeSec?: number }>
  }
  expect(visuals.length).toBeGreaterThan(0)
  expect(visuals.every((item) => (item.durationInFrames ?? 0) > 0)).toBe(true)
  expect(visuals.some((item) => item.mediaId === mediaId || item.source?.mediaId === mediaId)).toBe(true)
  expect(metadata.aiCaptions?.length ?? 0).toBeGreaterThan(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
})
