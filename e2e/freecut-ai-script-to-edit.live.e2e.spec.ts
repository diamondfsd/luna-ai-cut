import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'Dag9toSB'
const userDataDir = process.env.LUNA_E2E_EXISTING_USER_DATA_DIR
  ?? '/Users/zhouchao/Library/Application Support/luna-ai-cut'
const projectDir = path.join(userDataDir, 'freecut-workspace', 'projects', projectId)
const runsFile = path.join(projectDir, 'ai-editing-runs.json')

const scriptRequest = '我最近给我家宝宝做了一个 AI-agent， 可以通过语音聊天告诉AI， 会帮助她做一个简单的小游戏， 现在我想做个抖音视频， 帮我设计下脚本呢'
const editRequest = '可以呀 就按照你这个方案来吧'

interface StoredRun {
  request: string
  plan: string[]
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  toolCalls: Array<{ id: string; ok: boolean; message?: string }>
  completed: boolean
  completionNotes: string[]
}

async function readRuns(): Promise<StoredRun[]> {
  const stored = JSON.parse(await readFile(runsFile, 'utf8')) as { runs?: StoredRun[] }
  return stored.runs ?? []
}

async function waitForRunOrAssistantError(
  assistant: import('@playwright/test').Locator,
  expectedRunCount: number,
  timeout: number,
): Promise<void> {
  await Promise.race([
    expect.poll(async () => (await readRuns()).length, { timeout }).toBe(expectedRunCount),
    assistant.getByRole('alert').waitFor({ state: 'visible', timeout }).then(async () => {
      throw new Error(`剪辑助手报错：${await assistant.getByRole('alert').innerText()}`)
    }),
  ])
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作默认工作空间')
test.setTimeout(20 * 60_000)

test('先设计脚本，再按确认完成当前项目的整条剪辑', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const assistant = page.getByRole('complementary', { name: '剪辑助手' })
  if (!(await assistant.isVisible())) {
    await page.getByRole('button', { name: '打开剪辑助手' }).click()
  }
  await expect(assistant).toBeVisible()
  await page.getByRole('button', { name: '新建会话' }).click()

  const input = page.getByPlaceholder('描述想要完成的剪辑')
  const send = page.getByRole('button', { name: '发送剪辑请求' })
  const initialRunCount = (await readRuns()).length

  await input.fill(scriptRequest)
  await send.click()
  await waitForRunOrAssistantError(assistant, initialRunCount + 1, 7 * 60_000)
  await expect(input).toBeEnabled({ timeout: 7 * 60_000 })
  const scriptRun = (await readRuns()).at(-1)!
  expect(scriptRun).toMatchObject({ request: scriptRequest, completed: true, plan: [], toolCalls: [] })
  expect(scriptRun.timelineRevisionAfter).toBe(scriptRun.timelineRevisionBefore)

  await input.fill(editRequest)
  await send.click()
  await waitForRunOrAssistantError(assistant, initialRunCount + 2, 12 * 60_000)
  await expect(input).toBeEnabled({ timeout: 12 * 60_000 })
  const editRun = (await readRuns()).at(-1)!
  expect(editRun.request).toBe(editRequest)
  expect(editRun.completed).toBe(true)
  expect(editRun.plan.length).toBeLessThanOrEqual(4)
  expect(editRun.timelineRevisionAfter).toBeGreaterThan(editRun.timelineRevisionBefore)
  expect(editRun.toolCalls.some((call) => call.id === 'workspace.apply_edit_program' && call.ok)).toBe(true)
  expect(editRun.toolCalls.filter((call) => !call.ok)).toEqual([])
  expect(editRun.completionNotes).toEqual([])
  await expect(page.locator('[data-timeline-item]')).not.toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})
