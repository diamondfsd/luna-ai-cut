import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'qv5g0xJ1'
const clearConversation = process.env.LUNA_E2E_AI_CLEAR_CONVERSATION === '1'
const prompt = process.env.LUNA_E2E_AI_PROMPT
  ?? '请直接基于当前项目已有的视频素材剪一个简短成片：总时长控制在 8 秒左右，保留 2 到 4 个节奏清晰的连续镜头，只做必要的裁剪和镜头衔接，不新增素材、不添加字幕和音乐。完成后保存当前项目。'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(8 * 60_000)

interface ProjectFile {
  id?: string
  name?: string
  fps?: number
  timeline?: {
    items?: Array<{
      id: string
      type: string
      trackId: string
      from: number
      text?: string
      durationInFrames?: number
      transform?: { x?: number; y?: number; width?: number; height?: number }
      motionLayers?: unknown[]
      motionModifiers?: unknown[]
    }>
    tracks?: Array<{ id: string; name: string }>
  }
}

function timelineSignature(project: ProjectFile): string {
  const timeline = project.timeline
  return JSON.stringify({
    tracks: (timeline?.tracks ?? []).map(({ id, name }) => ({ id, name })),
    items: timeline?.items ?? [],
  })
}

function timelineEndFrame(project: ProjectFile): number {
  return Math.max(
    0,
    ...(project.timeline?.items ?? []).map((item) =>
      (item.from ?? 0) + (item.durationInFrames ?? 0)),
  )
}

test('通过当前页面的 Harness 助手剪辑当前项目的小短片', async ({ lunaLiveApp }) => {
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

  const before = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
  const beforeSignature = timelineSignature(before)

  // The current editor opens the host-owned Harness assistant from its toolbar.
  // Its composer lives inside the embedded page, so use a frame locator rather
  // than the removed FreeCut-side chat selectors.
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistantPanel).toBeVisible()
  const harnessFrameElement = assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(harnessFrameElement).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')

  const input = harness.locator('textarea:enabled').last()
  await expect(input).toBeVisible({ timeout: 60_000 })
  if (clearConversation) {
    const clearButton = harness.getByRole('button', { name: /清空|Clear/i }).last()
    if (await clearButton.isVisible().catch(() => false)) await clearButton.click()
  }
  await input.fill(prompt)
  await input.press('Enter')

  await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
    const visualItems = (saved.timeline?.items ?? [])
      .filter((item) => item.type === 'image' || item.type === 'video')
    const durationSeconds = timelineEndFrame(saved) / (saved.fps ?? 30)
    return {
      changed: timelineSignature(saved) !== beforeSignature,
      hasEnoughShots: visualItems.length >= 2,
      isShortEnough: durationSeconds <= 12,
    }
  }, { timeout: 7 * 60_000 }).toEqual({
    changed: true,
    hasEnoughShots: true,
    isShortEnough: true,
  })

  const saved = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
  const items = saved.timeline?.items ?? []
  const visualItems = items.filter((item) => item.type === 'image' || item.type === 'video')
  expect(visualItems.length).toBeGreaterThanOrEqual(2)
  expect(timelineEndFrame(saved) / (saved.fps ?? 30)).toBeLessThanOrEqual(12)
  expect(saved.id).toBe(projectId)
  expect(runtimeErrors).toEqual([])
})
