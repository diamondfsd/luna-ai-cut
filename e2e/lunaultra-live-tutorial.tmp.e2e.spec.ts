import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const tutorialBaseDir = process.env.LUNA_E2E_TUTORIAL_BASE_DIR
  ?? path.join(os.homedir(), 'Pictures', 'LunaAI-Cut')
const existingTutorialProjectId = process.env.LUNA_E2E_TUTORIAL_PROJECT_ID
const configuredHarnessHome = process.env.LUNA_E2E_HARNESS_SOURCE_DIR
  ?? path.join(os.homedir(), 'Library', 'Application Support', 'luna-ai-cut', 'deepseek-harness')

const tutorialPrompt = `
请直接在当前已经打开的 FreeCut 项目里执行剪辑，不要只回复剪辑方案，也不要停下来向我确认。
采用 video-shotcraft 的“自主自由创作”模式，使用项目内已经接入的 RemotionClip 能力和 vendor/video-shotcraft 镜头配方，凭空生成一支可以预览的 LunaUltra 直播功能教程样片。

主题是“LunaUltra 接入直播功能详细教程”，成片分成三个清晰章节，适合抖音竖屏短视频，时长控制在 60 到 90 秒：
1. 摄像头协议：解释 UVC 是什么、OBS 虚拟摄像头是什么，以及两者的关系；
2. LunaUltra 当前实现原理：手机连接 Luna，获取视频流，通过端口暴露给电脑，电脑端 OBS 获取视频流并创建虚拟摄像头；
3. 官方可能的两条路线：官方提供 UVC 支持后通过 USB 直连当摄像头，以及 App 原生接入抖音 SDK 后直接开播，说明后者为什么会更流畅。

请凭空创造必要的视觉素材：用 RemotionClip 生成标题卡、UVC/OBS/Luna/手机/电脑之间的数据流示意图和章节转场；用 video-shotcraft 的镜头设计语言做节奏、推近、连线和镜头衔接。把生成并渲染成功的素材实际加入当前项目时间线，至少有可见的视频或图片片段、章节文字和一条旁白/音频轨道；不要引用本地不存在的原始视频，不要只把源码留在素材库里。

画面文案使用简体中文，风格技术感但易懂，明确标注“当前方案”“官方路线”“动手能力强的用户可尝试”“相关协议已开源，暂不提供打包 APK”等信息，并在结尾加入免责声明：方案复杂，按自己的设备和网络情况测试。完成后保存项目，并在最后告诉我实际调用了哪些能力以及时间线里生成了什么。
`

interface WorkspaceIndex {
  projects?: Array<{ id: string; name: string; updatedAt?: number }>
}

interface HarnessWorkspaceStorage {
  unit: { name: string; version: number }
  global: { initialized: boolean; workspaceIds: string[]; archivedSessionIds: string[] }
  tables: {
    workspaces: Record<string, {
      path: string
      title: string
      sessionIds: string[]
      createdAt: string
      updatedAt: string
    }>
  }
}

interface StoredTimelineItem {
  id?: string
  type?: string
  trackId?: string
  from?: number
  durationInFrames?: number
  text?: string
  source?: { type?: string; mediaId?: string; [key: string]: unknown }
  [key: string]: unknown
}

interface StoredProject {
  id?: string
  name?: string
  metadata?: { fps?: number; width?: number; height?: number }
  timeline?: {
    tracks?: Array<{ id?: string; kind?: string; name?: string }>
    items?: StoredTimelineItem[]
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function projectIds(baseDir: string): Promise<string[]> {
  const index = await readJson<WorkspaceIndex>(
    path.join(baseDir, 'freecut-workspace', 'index.json'),
  )
  return (index?.projects ?? []).map((project) => project.id)
}

async function directoryFileCount(directory: string): Promise<number> {
  try {
    return (await readdir(directory, { withFileTypes: true })).length
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

async function seedHarnessConfiguration(baseDir: string): Promise<void> {
  const targetHome = path.join(baseDir, 'deepseek-harness')
  await mkdir(targetHome, { recursive: true })
  for (const fileName of ['settings.yaml', '.credentials.yaml']) {
    const source = path.join(configuredHarnessHome, fileName)
    const target = path.join(targetHome, fileName)
    try {
      await access(source)
      await cp(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  const workspacePath = path.join(targetHome, 'workspace')
  await mkdir(workspacePath, { recursive: true })
  const workspaceStoragePath = path.join(targetHome, 'storages', 'workspace.json')
  const stored = await readJson<HarnessWorkspaceStorage>(workspaceStoragePath)
  const workspaceEntries = stored?.tables?.workspaces ?? {}
  const existing = Object.entries(workspaceEntries).find(([, workspace]) => workspace.path === workspacePath)
  if (existing) return

  const now = new Date().toISOString()
  const workspaceId = randomUUID()
  const next: HarnessWorkspaceStorage = stored ?? {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
    tables: { workspaces: {} },
  }
  next.global = {
    initialized: true,
    workspaceIds: [workspaceId, ...next.global.workspaceIds],
    archivedSessionIds: next.global.archivedSessionIds,
  }
  next.tables.workspaces[workspaceId] = {
    path: workspacePath,
    title: path.basename(workspacePath),
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
  await mkdir(path.dirname(workspaceStoragePath), { recursive: true })
  await writeFile(workspaceStoragePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

async function tutorialState(baseDir: string, projectId: string) {
  const projectFile = path.join(
    baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )
  const project = await readJson<StoredProject>(projectFile)
  const items = project?.timeline?.items ?? []
  const tracks = project?.timeline?.tracks ?? []
  const clipsDirectory = path.join(
    baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'remotion-clips',
  )
  return {
    project,
    itemCount: items.length,
    visualCount: items.filter((item) => item.type === 'video' || item.type === 'image').length,
    textCount: items.filter((item) => item.type === 'text' || item.type === 'subtitle').length,
    audioCount: items.filter((item) => item.type === 'audio').length,
    trackKinds: tracks.map((track) => track.kind ?? track.name).filter(Boolean),
    remotionClipCount: await directoryFileCount(clipsDirectory),
    projectFile,
  }
}

test.skip(
  process.env.LUNA_E2E_RUN_TUTORIAL !== '1',
  '需要显式设置 LUNA_E2E_RUN_TUTORIAL=1 才会创建并修改教程项目',
)
test.setTimeout(45 * 60_000)

test('创建 LunaUltra 直播教程项目并让内置 AI 助手完成剪辑', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  await mkdir(tutorialBaseDir, { recursive: true })
  await seedHarnessConfiguration(tutorialBaseDir)
  const beforeIds = new Set(await projectIds(tutorialBaseDir))

  // The isolated test profile points at the real workspace only for this run;
  // the active user Electron instance keeps its own profile and remains untouched.
  await page.evaluate(async (settings) => {
    await window.luna.saveSettings(settings)
  }, {
    baseDir: tutorialBaseDir,
    localResourcesDir: path.join(tutorialBaseDir, 'localResources'),
    exportDir: path.join(tutorialBaseDir, 'export'),
  })

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await expect(page).toHaveURL(/#\/video-editor$/)
  let projectId = existingTutorialProjectId
  if (projectId) {
    const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
    await expect(projectCard).toBeVisible({ timeout: 30_000 })
    await projectCard.dblclick()
  } else {
    const createProject = page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ })
    await expect(createProject).toBeVisible({ timeout: 30_000 })
    await createProject.click()
    await expect.poll(
      () => projectIds(tutorialBaseDir).then((ids) => ids.filter((id) => !beforeIds.has(id))),
      { timeout: 30_000 },
    ).toHaveLength(1)
    projectId = (await projectIds(tutorialBaseDir)).find((id) => !beforeIds.has(id))
  }
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible({ timeout: 30_000 })
  if (!projectId) throw new Error('教程项目标识缺失')

  const assistantButton = page.getByRole('toolbar', { name: '编辑器工具栏' })
    .getByRole('button', { name: 'AI 助手', exact: true })
  await expect(assistantButton).toBeVisible()
  await assistantButton.click()
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistantPanel).toBeVisible()
  const harnessFrameElement = assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(harnessFrameElement).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')
  // A fresh Harness profile can show the internal-testing notice first and
  // the provider credential prompt second. Dismiss both before using the
  // conversation controls.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const onboarding = harness.getByRole('dialog').last()
    if (!await onboarding.isVisible().catch(() => false)) break
    const dismiss = onboarding.getByRole('button', { name: /继续|Continue|稍后配置|Later/i }).last()
    await expect(dismiss).toBeVisible({ timeout: 15_000 })
    await dismiss.click()
  }
  const newSession = harness.getByRole('button', { name: '新建会话', exact: true })
  await expect(newSession).toBeVisible({ timeout: 60_000 })
  await newSession.click()
  const input = harness.locator('textarea:enabled:not([readonly])').last()
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill(tutorialPrompt)
  await input.press('Enter')

  await expect.poll(async () => {
    const state = await tutorialState(tutorialBaseDir, projectId)
    return {
      itemCount: state.itemCount,
      visualCount: state.visualCount,
      textCount: state.textCount,
      audioCount: state.audioCount,
      remotionClipCount: state.remotionClipCount,
    }
  }, { timeout: 40 * 60_000, intervals: [5_000] }).toEqual({
    itemCount: expect.any(Number),
    visualCount: expect.any(Number),
    textCount: expect.any(Number),
    audioCount: expect.any(Number),
    remotionClipCount: expect.any(Number),
  })

  await expect.poll(async () => {
    const state = await tutorialState(tutorialBaseDir, projectId)
    return state.visualCount > 0 && state.textCount > 0 && state.remotionClipCount > 0
  }, { timeout: 40 * 60_000, intervals: [5_000] }).toBe(true)

  await expect(input).toBeEnabled({ timeout: 40 * 60_000 })
  await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)

  const finalState = await tutorialState(tutorialBaseDir, projectId)
  expect(finalState.project?.id).toBe(projectId)
  expect(finalState.visualCount).toBeGreaterThan(0)
  expect(finalState.textCount).toBeGreaterThan(0)
  expect(finalState.remotionClipCount).toBeGreaterThan(0)
  expect(finalState.trackKinds).toEqual(expect.arrayContaining(['video']))
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  await access(finalState.projectFile)
  console.log(JSON.stringify({
    projectId,
    projectFile: finalState.projectFile,
    itemCount: finalState.itemCount,
    visualCount: finalState.visualCount,
    textCount: finalState.textCount,
    audioCount: finalState.audioCount,
    remotionClipCount: finalState.remotionClipCount,
    trackKinds: finalState.trackKinds,
  }))
})
