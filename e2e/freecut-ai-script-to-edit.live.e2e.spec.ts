import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'Dag9toSB'

const scriptRequest = '我最近给我家宝宝做了一个 AI-agent， 可以通过语音聊天告诉AI， 会帮助她做一个简单的小游戏， 现在我想做个抖音视频， 帮我设计下脚本呢'
const editRequest = '可以IA 就按这个来'
const styleRequest = '我希望你的生成的旁白（不是视频里识别的），字体放大一点， 放在左上角， 并且加粗，看下关键字弄点颜色'

interface StoredRun {
  request: string
  plan: string[]
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  toolCalls: Array<{ id: string; ok: boolean; message?: string }>
  completed: boolean
  completionNotes: string[]
}

interface StoredTextItem {
  id: string
  type: string
  from?: number
  durationInFrames?: number
  text?: string
  fontSize?: number
  fontWeight?: string
  color?: string
  source?: { type: string }
  textSpans?: Array<{ text: string; color?: string }>
  transform?: { x?: number; y?: number; width?: number; height?: number }
}

interface StoredProject {
  metadata: { width: number; height: number; fps: number }
  timeline: {
    tracks: Array<{ id: string; kind: string }>
    items: StoredTextItem[]
  }
}

async function readRuns(runsFile: string): Promise<StoredRun[]> {
  const stored = JSON.parse(await readFile(runsFile, 'utf8')) as { runs?: StoredRun[] }
  return stored.runs ?? []
}

async function readProject(projectFile: string): Promise<StoredProject> {
  return JSON.parse(await readFile(projectFile, 'utf8')) as StoredProject
}

async function waitForRunOrAssistantError(
  assistant: import('@playwright/test').Locator,
  runsFile: string,
  expectedRunCount: number,
  timeout: number,
): Promise<void> {
  await Promise.race([
    expect.poll(async () => (await readRuns(runsFile)).length, { timeout }).toBe(expectedRunCount),
    assistant.getByRole('alert').waitFor({ state: 'visible', timeout }).then(async () => {
      throw new Error(`剪辑助手报错：${await assistant.getByRole('alert').innerText()}`)
    }),
  ])
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作默认工作空间')
test.setTimeout(20 * 60_000)

test('连续三轮完成脚本、剪辑和旁白可视化样式调整', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectDir = path.join(settings.baseDir, 'freecut-workspace', 'projects', projectId)
  const runsFile = path.join(projectDir, 'ai-editing-runs.json')
  const projectFile = path.join(projectDir, 'project.json')
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
  const initialRunCount = (await readRuns(runsFile)).length

  await input.fill(scriptRequest)
  await send.click()
  await waitForRunOrAssistantError(assistant, runsFile, initialRunCount + 1, 7 * 60_000)
  await expect(input).toBeEnabled({ timeout: 7 * 60_000 })
  const scriptRun = (await readRuns(runsFile)).at(-1)!
  expect(scriptRun).toMatchObject({ request: scriptRequest, completed: true, plan: [], toolCalls: [] })
  expect(scriptRun.timelineRevisionAfter).toBe(scriptRun.timelineRevisionBefore)

  await input.fill(editRequest)
  await send.click()
  await waitForRunOrAssistantError(assistant, runsFile, initialRunCount + 2, 12 * 60_000)
  await expect(input).toBeEnabled({ timeout: 12 * 60_000 })
  const editRun = (await readRuns(runsFile)).at(-1)!
  expect(editRun.request).toBe(editRequest)
  expect(editRun.completed).toBe(true)
  expect(editRun.plan).toEqual([])
  expect(editRun.toolCalls.filter((call) => !call.ok)).toEqual([])
  expect(editRun.completionNotes).toEqual([])
  await expect(page.locator('[data-timeline-item]')).not.toHaveCount(0)

  const projectAfterEdit = await readProject(projectFile)
  const changedTimeline = editRun.timelineRevisionAfter > editRun.timelineRevisionBefore
  if (changedTimeline) {
    expect(editRun.toolCalls.some(
      (call) => call.id === 'workspace.apply_edit_program' && call.ok,
    )).toBe(true)
  } else {
    expect(editRun.toolCalls).toEqual([])
    expect(projectAfterEdit.timeline.tracks.some((track) => track.kind === 'video')).toBe(true)
    expect(projectAfterEdit.timeline.tracks.some((track) => track.kind === 'audio')).toBe(true)
    expect(projectAfterEdit.timeline.items.some((item) => item.type === 'video')).toBe(true)
    expect(projectAfterEdit.timeline.items.some((item) => item.type === 'audio')).toBe(true)
    const endFrame = Math.max(...projectAfterEdit.timeline.items.map(
      (item) => (item.from ?? 0) + (item.durationInFrames ?? 0),
    ))
    expect(endFrame / projectAfterEdit.metadata.fps).toBeLessThanOrEqual(60)
  }
  const narrationBeforeStyle = projectAfterEdit.timeline.items.filter(
    (item) => (item.type === 'text' && item.text) ||
      (item.type === 'subtitle' && item.source?.type === 'manual'),
  )
  expect(narrationBeforeStyle.length).toBeGreaterThan(0)

  await input.fill(styleRequest)
  await send.click()
  await waitForRunOrAssistantError(assistant, runsFile, initialRunCount + 3, 7 * 60_000)
  await expect(input).toBeEnabled({ timeout: 7 * 60_000 })
  const styleRun = (await readRuns(runsFile)).at(-1)!
  expect(styleRun).toMatchObject({ request: styleRequest, completed: true, plan: [] })
  const changedStyle = styleRun.timelineRevisionAfter > styleRun.timelineRevisionBefore
  if (changedStyle) {
    expect(styleRun.toolCalls.some(
      (call) => call.id === 'workspace.apply_edit_program' && call.ok,
    )).toBe(true)
  } else {
    expect(styleRun.toolCalls).toEqual([])
  }
  expect(styleRun.toolCalls.filter((call) => !call.ok)).toEqual([])
  expect(styleRun.completionNotes).toEqual([])

  const narrationIds = new Set(narrationBeforeStyle.map((item) => item.id))
  await expect.poll(async () => {
    const project = await readProject(projectFile)
    return project.timeline.items.filter((item) => narrationIds.has(item.id) && item.type === 'text')
  }, { timeout: 30_000 }).toHaveLength(narrationBeforeStyle.length)
  const projectAfterStyle = await readProject(projectFile)
  const styledNarration = projectAfterStyle.timeline.items.filter(
    (item) => narrationIds.has(item.id) && item.type === 'text',
  )
  expect(styledNarration.every((item) => item.fontWeight === 'bold')).toBe(true)
  const narrationBeforeById = new Map(narrationBeforeStyle.map((item) => [item.id, item]))
  if (changedStyle) {
    const fontSizeDeltas = styledNarration.map((item) =>
      (item.fontSize ?? 0) - (narrationBeforeById.get(item.id)?.fontSize ?? 0),
    )
    expect(fontSizeDeltas.every((delta) => delta >= 0)).toBe(true)
    expect(fontSizeDeltas.filter((delta) => delta > 0).length)
      .toBeGreaterThanOrEqual(Math.max(1, styledNarration.length - 1))
  }
  expect(styledNarration.every((item) => {
    const transform = item.transform
    if (!transform?.width || !transform.height) return false
    const left = projectAfterStyle.metadata.width / 2 + (transform.x ?? 0) - transform.width / 2
    const top = projectAfterStyle.metadata.height / 2 + (transform.y ?? 0) - transform.height / 2
    return left / projectAfterStyle.metadata.width <= 0.15 && top / projectAfterStyle.metadata.height <= 0.15
  })).toBe(true)
  expect(styledNarration.some((item) => {
    const colors = new Set(item.textSpans?.map((span) => span.color).filter(Boolean))
    return colors.size >= 2
  })).toBe(true)
  expect(runtimeErrors).toEqual([])
})
