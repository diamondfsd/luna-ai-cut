import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'J4ANiM2O'
const prompt = process.env.LUNA_E2E_AI_PROMPT
  ?? '帮我基于当前素材库的这个新UI原型图，完成 挑战一个人做出剪映，第一天，UI重构。视频的制作。我确认清理当前不相关的旧测试内容，请直接完成成片。'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(8 * 60_000)

interface ProjectFile {
  timeline?: {
    items?: Array<{
      id: string
      type: string
      text?: string
      durationInFrames?: number
      motionModifiers?: unknown[]
    }>
  }
}

interface AiEditingRunsFile {
  runs?: Array<{
    completed?: boolean
    skillId?: string
    production?: {
      blueprint?: {
        title?: string
        shots?: Array<{ id?: string; mediaId?: string; region?: string }>
      }
      review?: { passed?: boolean }
    }
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

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await page.getByRole('button', { name: '打开剪辑助手' }).click()
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  await expect(input).toBeEnabled()
  await input.fill(prompt)
  await page.getByRole('button', { name: '发送剪辑请求' }).click()

  const error = page.getByRole('alert')
  await expect(input).toBeEnabled({ timeout: 7 * 60_000 })
  await expect(error).toHaveCount(0)

  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
    return saved.timeline?.items?.filter((item) => item.type === 'text').length ?? 0
  }, { timeout: 90_000 }).toBeGreaterThanOrEqual(3)

  const saved = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
  const items = saved.timeline?.items ?? []
  const textItems = items.filter((item) => item.type === 'text')
  expect(items.some((item) => item.type === 'image' && (item.motionModifiers?.length ?? 0) > 0)).toBe(true)
  expect(textItems.length).toBeGreaterThanOrEqual(3)
  expect(textItems.some((item) => item.text === 'Main')).toBe(false)
  const runs = JSON.parse(await readFile(path.join(path.dirname(projectFile), 'ai-editing-runs.json'), 'utf8')) as AiEditingRunsFile
  expect(runs.runs?.at(-1)).toMatchObject({
    completed: true,
    skillId: 'product-ui-launch',
    production: { review: { passed: true } },
  })
  const blueprint = runs.runs?.at(-1)?.production?.blueprint
  expect(blueprint?.title).toMatch(/挑战.*剪映.*UI.*重构/)
  expect(blueprint?.shots).toHaveLength(5)
  expect(blueprint?.shots?.every((shot, index) => shot.id === `SHOT-0${index + 1}` && Boolean(shot.mediaId))).toBe(true)
  expect(blueprint?.shots?.some((shot) => shot.region === 'timeline')).toBe(true)
  expect(runtimeErrors).toEqual([])
})
