import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'J4ANiM2O'
const clearConversation = process.env.LUNA_E2E_AI_CLEAR_CONVERSATION === '1'
const prompt = process.env.LUNA_E2E_AI_PROMPT
  ?? '帮我基于当前素材库的这个新UI原型图，完成 挑战一个人做出剪映，第一天，UI重构。视频的制作，请直接完成成片。'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(8 * 60_000)

interface ProjectFile {
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

interface AiEditingRunsFile {
  runs?: Array<{
    completed?: boolean
    skillId?: string
    timelineRevisionBefore?: number
    timelineRevisionAfter?: number
    toolCalls?: Array<{ id?: string; ok?: boolean }>
  }>
}

test('用当前项目的剪辑助手制作 UI 重构主题短片', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const projectFile = path.join(
    process.env.LUNA_E2E_EXISTING_USER_DATA_DIR ?? '/Users/zhouchao/Library/Application Support/luna-ai-cut',
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )
  const runsFile = path.join(path.dirname(projectFile), 'ai-editing-runs.json')

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await page.getByRole('button', { name: '打开剪辑助手' }).click()
  if (clearConversation) {
    await page.getByRole('button', { name: '清空剪辑助手记录' }).click()
    await expect(page.getByText('根据时间轴、字幕和本地素材分析，直接完成剪辑操作。')).toBeVisible()
  }
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  await expect(input).toBeEnabled()
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送剪辑请求' }).click()

  const error = page.getByRole('alert')
  await expect(input).toBeEnabled({ timeout: 7 * 60_000 })
  await expect(error).toHaveCount(0)

  await expect.poll(async () => {
    const runs = JSON.parse(await readFile(runsFile, 'utf8')) as AiEditingRunsFile
    return runs.runs?.at(-1)?.completed
  }, { timeout: 90_000 }).toBe(true)

  const saved = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
  const items = saved.timeline?.items ?? []
  expect(items.some((item) => item.type === 'image' || item.type === 'video')).toBe(true)
  const runs = JSON.parse(await readFile(runsFile, 'utf8')) as AiEditingRunsFile
  const run = runs.runs?.at(-1)
  expect(run?.timelineRevisionAfter).toBeGreaterThan(run?.timelineRevisionBefore ?? 0)
  expect(run?.toolCalls?.some((call) => call.id === 'workspace.apply_edit_program' && call.ok)).toBe(true)
  const visualItems = items.filter((item) => item.type === 'image' || item.type === 'video')
  expect(visualItems.some((item) => (item.motionLayers?.length ?? 0) > 0)).toBe(true)
  expect(new Set(visualItems.map((item) => JSON.stringify(item.transform ?? null))).size).toBeGreaterThan(1)
  expect(runtimeErrors).toEqual([])
})
