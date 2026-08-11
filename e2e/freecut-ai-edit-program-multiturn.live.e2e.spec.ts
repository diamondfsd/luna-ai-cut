import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'J4ANiM2O'

interface StoredItem {
  id: string
  type: string
  label: string
  trackId: string
  from: number
  durationInFrames: number
  text?: string
  transform?: { x?: number; y?: number; width?: number; height?: number }
  motionLayers?: unknown[]
}

interface StoredProject {
  timeline?: { items?: StoredItem[] }
}

interface StoredRun {
  id: string
  request: string
  completed: boolean
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  toolCalls: Array<{ id: string; ok: boolean; message?: string }>
}

interface StoredRuns {
  runs?: StoredRun[]
}

async function readProject(projectFile: string): Promise<StoredProject> {
  return JSON.parse(await readFile(projectFile, 'utf8')) as StoredProject
}

async function readRuns(runsFile: string): Promise<StoredRun[]> {
  return (JSON.parse(await readFile(runsFile, 'utf8')) as StoredRuns).runs ?? []
}

function visualItems(project: StoredProject): StoredItem[] {
  return (project.timeline?.items ?? []).filter((item) => item.type === 'image' || item.type === 'video')
}

function textItems(project: StoredProject): StoredItem[] {
  return (project.timeline?.items ?? []).filter((item) => item.type === 'text')
}

function visualSignature(project: StoredProject): string {
  return JSON.stringify(visualItems(project).map((item) => ({
    id: item.id,
    from: item.from,
    durationInFrames: item.durationInFrames,
    transform: item.transform,
    motionLayers: item.motionLayers,
  })))
}

function textSignature(project: StoredProject): string {
  return JSON.stringify(textItems(project).map((item) => ({
    id: item.id,
    from: item.from,
    durationInFrames: item.durationInFrames,
    text: item.text,
  })))
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(15 * 60_000)

test('真实剪辑助手可连续完成成片、文字调整和镜头调整', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectDir = path.join(settings.baseDir, 'freecut-workspace', 'projects', projectId)
  const projectFile = path.join(projectDir, 'project.json')
  const runsFile = path.join(projectDir, 'ai-editing-runs.json')
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  await page.getByRole('button', { name: '打开剪辑助手' }).click()

  const input = page.getByPlaceholder('描述想要完成的剪辑')
  const send = page.getByRole('button', { name: '发送剪辑请求' })
  const initialRunCount = (await readRuns(runsFile)).length

  const sendTurn = async (prompt: string, expectedRunCount: number): Promise<StoredRun> => {
    await expect(input).toBeEnabled()
    await input.fill(prompt)
    await send.click()
    await expect.poll(async () => (await readRuns(runsFile)).length, { timeout: 7 * 60_000 })
      .toBe(expectedRunCount)
    await expect(input).toBeEnabled({ timeout: 7 * 60_000 })
    const run = (await readRuns(runsFile)).at(-1)!
    expect(run.request).toBe(prompt)
    expect(run.completed).toBe(true)
    expect(run.timelineRevisionAfter).toBeGreaterThan(run.timelineRevisionBefore)
    expect(run.toolCalls.some((call) => call.id === 'workspace.apply_edit_program' && call.ok)).toBe(true)
    expect(run.toolCalls.filter((call) => !call.ok)).toEqual([])
    return run
  }

  const firstPrompt = [
    '请重做当前这个“挑战一个人做出剪映，第一天，UI重构”的短视频，直接完成成片。',
    '总时长控制在 8 秒左右。使用当前 UI 图片制作至少 4 个连续镜头，分别突出顶部导航、左侧素材区、中央预览区和底部时间轴。',
    '每个镜头必须有明显不同的取景中心、缩放比例和运镜起止状态。保留开场、中段、收尾三段简洁文字。',
  ].join('\n')
  await sendTurn(firstPrompt, initialRunCount + 1)
  const firstProject = await readProject(projectFile)
  const firstVisuals = visualItems(firstProject)
  expect(firstVisuals.length).toBeGreaterThanOrEqual(4)
  expect(textItems(firstProject).length).toBeGreaterThanOrEqual(3)
  expect(new Set(firstVisuals.map((item) => JSON.stringify(item.transform))).size).toBeGreaterThanOrEqual(3)
  expect(firstVisuals.filter((item) => (item.motionLayers?.length ?? 0) > 0).length)
    .toBeGreaterThanOrEqual(4)

  const firstVisualSignature = visualSignature(firstProject)
  const secondPrompt = [
    '现在只调整现有三段文字，不要重做或改变任何画面镜头。',
    '开场改成“一个人做剪辑软件”，中段改成“DAY 1 · UI 重构”，收尾改成“明天继续”。',
    '文字要保持短促，时间位置沿用当前开场、中段和收尾结构。',
  ].join('\n')
  await sendTurn(secondPrompt, initialRunCount + 2)
  const secondProject = await readProject(projectFile)
  expect(textItems(secondProject).map((item) => item.text)).toEqual(expect.arrayContaining([
    '一个人做剪辑软件',
    'DAY 1 · UI 重构',
    '明天继续',
  ]))
  expect(visualSignature(secondProject)).toBe(firstVisualSignature)

  const secondTextSignature = textSignature(secondProject)
  const secondVisualSignature = visualSignature(secondProject)
  const thirdPrompt = [
    '现在只调整画面镜头，不修改文字文案和总时长。',
    '让四个 UI 镜头的特写差异更强：顶部导航、左侧素材区、中央预览区、底部时间轴必须一眼能看出是不同区域。',
    '每个镜头使用不同的推近或横移方向，避免四段使用相同 transform 或相同运镜参数。',
  ].join('\n')
  await sendTurn(thirdPrompt, initialRunCount + 3)
  const thirdProject = await readProject(projectFile)
  expect(textSignature(thirdProject)).toBe(secondTextSignature)
  expect(visualSignature(thirdProject)).not.toBe(secondVisualSignature)
  const thirdVisuals = visualItems(thirdProject)
  expect(new Set(thirdVisuals.map((item) => JSON.stringify(item.transform))).size)
    .toBeGreaterThanOrEqual(3)
  expect(new Set(thirdVisuals.map((item) => JSON.stringify(item.motionLayers))).size)
    .toBeGreaterThanOrEqual(3)
  expect(runtimeErrors).toEqual([])
})
