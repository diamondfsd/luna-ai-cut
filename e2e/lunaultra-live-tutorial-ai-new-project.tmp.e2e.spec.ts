import { access, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'

const scriptPrompt = `
我们现在从零制作一个新的 LunaUltra 直播功能科普短视频。先不要创建项目素材、不要调用任何时间线、Remotion、TTS 或其他编辑工具，只作为编导和我沟通脚本。

请先写出一个 60 秒以内的结构化脚本，必须覆盖这些准确内容：
1. 实现原理：解释 UVC 是摄像头设备协议，OBS 是接收/处理视频流并输出虚拟摄像头的软件，两者不是同一层。
2. 当前方案的问题：手机连接 Luna，电脑通过端口和 OBS 接收视频流，实际需要手机和电脑，链路长、配置复杂。
3. 解决方案设想：做一个树莓派类的小硬件，在硬件上运行程序接收 Luna Wi-Fi 视频流，再转换成 UVC；它既可以用 USB 连接手机，也可以用 USB 连接电脑。
4. 官方路线一：Luna 直接支持 UVC，通过 USB 线直接被手机或电脑识别。
5. 官方路线二：Luna 直接把视频推给 Insta360 App，App 再通过抖音 SDK 推流直播。

请给出每段的时码、旁白、屏幕文字和动画画面建议，内容密集处可以设计成 1.5 倍或 2 倍节奏。先只输出脚本和画面设计，等我下一条确认后再制作。
`

const productionPrompt = `
脚本可以，按刚才的脚本直接完成这个新项目的实际剪辑，不要只回复方案。现在请调用 FreeCut 的编辑能力完成成片：

- 成片控制在 60 秒以内，建议 55 到 60 秒；保持 4:3 画布 1440×1080、30fps。
- 先用 RemotionClip 创建自包含的动画视觉素材，再渲染成真实 MP4 并加入时间线。每个知识点都必须有持续动画，不要用大段静止信息卡：UVC 与 OBS 分层关系、手机和电脑的当前方案链路、树莓派类硬件接收 Luna Wi-Fi 并转换 UVC 的方案、官方 UVC 直连、Luna → Insta360 App → 抖音 SDK 都要有数据包/箭头/节点高亮/链路变化等动作。
- 旁白使用 TTS，按脚本分段加入；文字字幕和章节标题要与旁白对应。内容过多的段落允许把旁白和画面用 1.5x 或 2x 加速，但必须保证普通观众能看懂。
- 先调用 luna.project.inspect() 和 luna.timeline.inspectContext() 获取当前新项目的真实 ID。完成源码更新、预览/渲染和时间线加入后，再次检查 Remotion 状态、项目画布、视频时长、音频和文字片段。
- 最终时间线只能保留一份主视觉视频，不要重复追加造成时长翻倍；如果生成了新版本，按“加入新片段、删除旧视觉片段、把新片段移动到 0 秒、再次 inspect”的流程替换。保存项目。
- 直接执行全部制作并返回结构化结果，不要再次向我确认，也不要只给文字说明。
`

interface Item {
  type?: string
  from?: number
  durationInFrames?: number
  mediaId?: string
}

interface Project {
  id?: string
  metadata?: { width?: number; height?: number; fps?: number }
  duration?: number
  updatedAt?: number
  timeline?: { items?: Item[] }
}

interface RemotionClip {
  status?: string
  width?: number
  height?: number
  sourceRevision?: number
  artifact?: { fileSize?: number; mediaId?: string }
}

async function projectIds(workspaceDir: string): Promise<string[]> {
  const projectsDir = path.join(workspaceDir, 'freecut-workspace', 'projects')
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function readRemotionClips(projectRoot: string): Promise<RemotionClip[]> {
  const clipsDir = path.join(projectRoot, 'remotion-clips')
  const entries = await readdir(clipsDir, { withFileTypes: true }).catch(() => [])
  const clips: RemotionClip[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      clips.push(JSON.parse(await readFile(path.join(clipsDir, entry.name, 'clip.json'), 'utf8')) as RemotionClip)
    } catch {
      // The assistant may create the directory before persisting clip.json.
    }
  }
  return clips
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会创建真实项目并调用内置 AI 助手')
test.setTimeout(60 * 60_000)

test('让内置 AI 助手从脚本沟通开始制作新的 LunaUltra 直播教程', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  await mkdir(baseDir, { recursive: true })
  await page.evaluate(async (settings) => window.luna.saveSettings(settings), {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: path.join(baseDir, 'export'),
  })

  const beforeIds = new Set(await projectIds(baseDir))
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const createProject = page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ })
  await expect(createProject).toBeVisible({ timeout: 30_000 })
  await createProject.click()

  await expect.poll(() => projectIds(baseDir).then((ids) => ids.filter((id) => !beforeIds.has(id))), {
    timeout: 30_000,
  }).toHaveLength(1)
  const projectId = (await projectIds(baseDir)).find((id) => !beforeIds.has(id))
  if (!projectId) throw new Error('新项目创建失败')

  const projectFile = path.join(baseDir, 'freecut-workspace', 'projects', projectId, 'project.json')
  await access(projectFile)
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible({ timeout: 30_000 })
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

  await input.fill(scriptPrompt)
  await input.press('Enter')
  await expect(input).toBeEnabled({ timeout: 10 * 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)

  await input.fill(productionPrompt)
  await input.press('Enter')

  await expect.poll(async () => {
    const project = JSON.parse(await readFile(projectFile, 'utf8')) as Project
    const items = project.timeline?.items ?? []
    const videos = items.filter((item) => item.type === 'video')
    const clips = await readRemotionClips(path.dirname(projectFile))
    const readyClips = clips.filter((clip) => clip.status === 'ready' && (clip.artifact?.fileSize ?? 0) > 100_000)
    const visual = videos.find((item) => item.from === 0 && (item.durationInFrames ?? 0) > 0)
    return `${project.metadata?.width}x${project.metadata?.height}` === '1440x1080' &&
      project.metadata?.fps === 30 &&
      videos.length === 1 &&
      (visual?.durationInFrames ?? 0) > 0 &&
      (visual?.durationInFrames ?? 0) <= 1800 &&
      items.filter((item) => item.type === 'audio').length > 0 &&
      items.filter((item) => item.type === 'text' || item.type === 'subtitle').length > 0 &&
      readyClips.length > 0
  }, { timeout: 45 * 60_000, intervals: [5_000] }).toBe(true)

  await expect(input).toBeEnabled({ timeout: 10 * 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, projectFile, project: JSON.parse(await readFile(projectFile, 'utf8')) }))
})
