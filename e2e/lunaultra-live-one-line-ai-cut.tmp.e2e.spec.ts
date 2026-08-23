import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'
import {
  inspectHarnessSession,
  listHarnessSessionLogs,
  type HarnessSessionLog,
  type HarnessSessionSnapshot,
  waitForHarnessSessionLog,
} from './harnessSessionMonitor'

const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'
const oneLinePrompt = '请直接在 FreeCut 当前项目中完成并保存一条总时长严格不超过1800帧（60秒）的 OBS 与 UVC 虚拟摄像头模拟科普成片，不要只回复方案；开始制作前可以使用隐藏浏览器访问公开网页，搜索并读取 OBS、UVC、虚拟摄像头和 Luna 直播方案的相关资料，核对事实后再用 Remotion、配音和字幕完成当前项目时间线。'

interface ProjectIndex {
  projects?: Array<{ id?: string; updatedAt?: number }>
}

interface TimelineItem {
  type?: string
  from?: number
  durationInFrames?: number
  mediaId?: string
  sourceWidth?: number
  sourceHeight?: number
}

interface Project {
  id?: string
  updatedAt?: number
  timeline?: { items?: TimelineItem[] }
}

function projectIsComplete(project: Project, readyClips: Array<{ status?: string; artifact?: { fileSize?: number } }>): boolean {
  const items = project.timeline?.items ?? []
  const videos = items.filter((item) => item.type === 'video')
  const audio = items.filter((item) => item.type === 'audio')
  const texts = items.filter((item) => item.type === 'text' || item.type === 'subtitle')
  const visualEnd = videos.length > 0
    ? Math.max(...videos.map((item) => (item.from ?? 0) + (item.durationInFrames ?? 0)))
    : 0
  return videos.length === 1 &&
    videos[0]?.from === 0 &&
    (videos[0]?.durationInFrames ?? 0) > 0 &&
    (videos[0]?.durationInFrames ?? 0) <= 1800 &&
    audio.length > 0 &&
    texts.length > 0 &&
    visualEnd > 0 &&
    readyClips.some((clip) => clip.status === 'ready' && (clip.artifact?.fileSize ?? 0) > 100_000)
}

async function readProjectIndex(): Promise<ProjectIndex> {
  return JSON.parse(await readFile(path.join(baseDir, 'freecut-workspace', 'index.json'), 'utf8')) as ProjectIndex
}

async function readReadyRemotionClips(projectRoot: string): Promise<Array<{ status?: string; artifact?: { fileSize?: number } }>> {
  const clipsRoot = path.join(projectRoot, 'remotion-clips')
  const entries = await readdir(clipsRoot, { withFileTypes: true }).catch(() => [])
  const clips = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      clips.push(JSON.parse(await readFile(path.join(clipsRoot, entry.name, 'clip.json'), 'utf8')) as {
        status?: string
        artifact?: { fileSize?: number }
      })
    } catch {
      // Ignore an in-progress clip directory.
    }
  }
  return clips
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会调用真实 AI 助手')
test.setTimeout(45 * 60_000)

test('用一句话让 AI 完成 OBS 与 UVC 摄像头模拟科普', async ({ lunaLiveApp }, testInfo) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.evaluate(async (settings) => window.luna.saveSettings(settings), {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: path.join(baseDir, 'export'),
  })

  const beforeIds = new Set((await readProjectIndex()).projects?.map((project) => project.id).filter(Boolean))
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await expect(page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()

  const findNewProjectId = async (): Promise<string | null> => {
    const projects = (await readProjectIndex()).projects ?? []
    return projects.find((project) => project.id && !beforeIds.has(project.id))?.id ?? null
  }
  await expect.poll(findNewProjectId, { timeout: 60_000 }).not.toBeNull()
  const projectId = await findNewProjectId()
  if (!projectId) throw new Error('新项目创建成功但没有找到项目 ID')
  const projectFile = path.join(baseDir, 'freecut-workspace', 'projects', projectId, 'project.json')
  await access(projectFile)
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()

  const panel = page.getByRole('complementary', { name: 'AI 助手' })
  const frame = panel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(frame).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const onboarding = harness.getByRole('dialog').last()
    if (!await onboarding.isVisible().catch(() => false)) break
    await onboarding.getByRole('button', { name: /继续|Continue|稍后配置|Later/i }).last().click()
  }
  const newSession = harness.getByRole('button', { name: '新建会话', exact: true })
  await expect(newSession).toBeVisible({ timeout: 60_000 })
  await newSession.click()
  const input = harness.locator('textarea:enabled:not([readonly])').last()
  await expect(input).toBeVisible({ timeout: 60_000 })
  const before = JSON.parse(await readFile(projectFile, 'utf8')) as Project
  const sessionsRoot = path.join(baseDir, 'deepseek-harness', 'sessions')
  const beforeSessions = new Map((await listHarnessSessionLogs(sessionsRoot)).map((session) => [session.path, session.mtimeMs]))
  const promptStartedAt = Date.now()
  await input.fill(oneLinePrompt)
  await input.press('Enter')

  let sessionLog: HarnessSessionLog | undefined
  try {
    sessionLog = await waitForHarnessSessionLog(sessionsRoot, beforeSessions, promptStartedAt)
  } catch (error) {
    await testInfo.attach('harness-session-diagnostics.json', {
      body: JSON.stringify({ reason: error instanceof Error ? error.message : String(error), runtimeErrors }, null, 2),
      contentType: 'application/json',
    })
    throw error
  }

  const readHarnessSnapshot = async (): Promise<HarnessSessionSnapshot | undefined> => {
    if (!sessionLog) return undefined
    const latestLog = (await listHarnessSessionLogs(sessionsRoot)).find((candidate) => candidate.path === sessionLog?.path)
    try {
      return await inspectHarnessSession(latestLog ?? sessionLog)
    } catch {
      // A compressed append can be between durable frames while the monitor reads it.
      return undefined
    }
  }

  const failWithDiagnostics = async (reason: string): Promise<never> => {
    const session = await readHarnessSnapshot()
    const project = await readFile(projectFile, 'utf8').catch(() => '')
    const diagnostics = { reason, session, runtimeErrors: runtimeErrors.slice(-100) }
    await testInfo.attach('harness-session-diagnostics.json', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    })
    await testInfo.attach('freecut-project.json', { body: project, contentType: 'application/json' })
    throw new Error(`${reason}\n${JSON.stringify(diagnostics)}`)
  }

  const checkHarnessHealth = async (): Promise<void> => {
    const fatalRuntimeErrors = runtimeErrors.filter((message) =>
      /conversation Context .*more than one start Match|connection sink threw|connection lost|Harness Web 已停止/i.test(message))
    if (fatalRuntimeErrors.length > 0) {
      await failWithDiagnostics(`Harness 连接或会话流异常: ${fatalRuntimeErrors.at(-1)}`)
    }
    const snapshot = await readHarnessSnapshot()
    if (!snapshot) return
    const now = Date.now()
    if (snapshot.openStep && snapshot.openStepStartedAt &&
      !snapshot.openStepLastAssistantEventAt && now - snapshot.openStepStartedAt > 3 * 60_000) {
      await failWithDiagnostics(`模型在 step ${snapshot.openStep.turn}:${snapshot.openStep.step} 超过 3 分钟没有产生首个事件`)
    }
    const lastCallAt = snapshot.pendingCalls.at(-1)?.startedAt
    if (lastCallAt && now - lastCallAt > 20 * 60_000) {
      await failWithDiagnostics(`工具 ${snapshot.pendingCalls.at(-1)?.name ?? 'unknown'} 执行超过 20 分钟没有返回`)
    }
  }

  const harnessCompleted = (snapshot: HarnessSessionSnapshot | undefined): boolean => Boolean(
    snapshot &&
    snapshot.lastEventType === 'turn/end' &&
    snapshot.turnEndReason === 'completed' &&
    snapshot.openStep === undefined &&
    snapshot.pendingCalls.length === 0 &&
    snapshot.errors.length === 0,
  )

  const completionDeadline = Date.now() + 40 * 60_000
  while (Date.now() < completionDeadline) {
    await checkHarnessHealth()
    const project = JSON.parse(await readFile(projectFile, 'utf8')) as Project
    const readyClips = await readReadyRemotionClips(path.dirname(projectFile))
    const session = await readHarnessSnapshot()
    if (
      (project.updatedAt ?? 0) > (before.updatedAt ?? 0) &&
      projectIsComplete(project, readyClips) &&
      harnessCompleted(session)
    ) break
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  const finalProject = JSON.parse(await readFile(projectFile, 'utf8')) as Project
  const finalClips = await readReadyRemotionClips(path.dirname(projectFile))
  const finalSession = await readHarnessSnapshot()
  if (
    (finalProject.updatedAt ?? 0) <= (before.updatedAt ?? 0) ||
    !projectIsComplete(finalProject, finalClips) ||
    !harnessCompleted(finalSession)
  ) {
    await failWithDiagnostics('AI 助手在 40 分钟内没有完成可验证的成片')
  }

  await expect(input).toBeEnabled({ timeout: 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, projectFile, prompt: oneLinePrompt, project: JSON.parse(await readFile(projectFile, 'utf8')) }))
})
