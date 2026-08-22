import { access, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = 'TnPSuAWd'
const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'
const prompt = `
请直接在当前已经打开的 FreeCut 项目里继续剪辑，不要只回复方案，不要停下来向我确认。请先调用 luna.project.inspect() 和 luna.timeline.inspectContext()，确认当前项目、4:3 画布、真实视频片段、旁白和章节文字的 ID，再开始修改。

当前成片的问题是知识点内部太静止。请保留当前项目的 90 秒时长、1440×1080 的 4:3 画布、现有四段中文旁白、背景音乐、旁白起点和章节字幕，但重做 Remotion 视觉素材，让每个知识点都有独立的动画讲解，而不是只有整页淡入：
1. 0 到 5 秒标题：Luna 设备出现，信号波纹和直播状态逐步亮起。
2. 5 到 28 秒摄像头协议，拆成三个有动作的知识点：UVC 要有摄像头通过 USB 线向电脑发送数据包的动画；OBS 虚拟摄像头要有视频流进入 OBS、再从 OBS 输出给直播应用的动画；最后用分层和流动箭头明确 UVC 是设备协议、OBS 是软件出口。
3. 28 到 53 秒当前实现原理：让数据包连续经过“手机 → Luna → 端口 → OBS → 虚拟摄像头”，每个节点被经过时高亮并显示当前动作，端口转发和 OBS 虚拟输出要有明显动态，不要只摆五个静态框。
4. 53 到 80 秒官方可能路线：先动画演示 USB 连接直达电脑并显示更短链路/低延迟，再动画演示 App 获取视频流后直接进入抖音 SDK 并显示更少中转；两条路线要有动态对比。
5. 80 到 90 秒结尾：协议、当前方案、官方路线和免责声明逐条出现，并保留“动手能力强的用户可尝试”“相关协议已开源，暂不提供打包 APK”“按自己的设备和网络情况测试”。

必须使用 RemotionClip 修改并渲染真实动画素材，必要时结合 video-shotcraft 的镜头节奏能力；渲染完成后必须把新的 MP4 作为真实视频素材加入当前项目时间线，替换旧的静态视觉片段，保存项目。不能只更新源码、不能只生成字幕和 TTS、不能只给我文字说明。Remotion 源码要保持项目可独立渲染，只使用可解析的项目内依赖或自包含图形，避免引用项目外不存在的包。每次工具成功后把结构化结果返回给模型，继续完成剩余步骤，最后检查 RemotionClip 状态、时间线和项目画布。
`

interface TimelineItem {
  id?: string
  type?: string
  mediaId?: string
  from?: number
  durationInFrames?: number
}

interface ProjectFile {
  id?: string
  updatedAt?: number
  metadata?: { width?: number; height?: number; fps?: number }
  timeline?: { items?: TimelineItem[] }
}

interface RemotionClip {
  clipId?: string
  width?: number
  height?: number
  status?: string
  sourceRevision?: number
  artifact?: { mediaId?: string; fileSize?: number }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

async function readRemotionClips(baseDir: string): Promise<RemotionClip[]> {
  const directory = path.join(baseDir, 'freecut-workspace', 'projects', projectId, 'remotion-clips')
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const clips: RemotionClip[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const clipFile = path.join(directory, entry.name, 'clip.json')
    try {
      clips.push(await readJson<RemotionClip>(clipFile))
    } catch {
      // The assistant can create the directory before writing clip.json.
    }
  }
  return clips
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(45 * 60_000)

test('让内置 AI 助手重做 LunaUltra 每个知识点的动画讲解', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.evaluate(async (settings) => {
    await window.luna.saveSettings(settings)
  }, {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: path.join(baseDir, 'export'),
  })
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectFile = path.join(settings.baseDir, 'freecut-workspace', 'projects', projectId, 'project.json')
  await access(projectFile)

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible({ timeout: 30_000 })
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible({ timeout: 30_000 })

  const before = await readJson<ProjectFile>(projectFile)
  const beforeClips = await readRemotionClips(settings.baseDir)
  const beforeRevision = Math.max(0, ...beforeClips.map((clip) => clip.sourceRevision ?? 0))

  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistantPanel).toBeVisible()
  const frameElement = assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(frameElement).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')

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
  await input.fill(prompt)
  await input.press('Enter')

  await expect.poll(async () => {
    const saved = await readJson<ProjectFile>(projectFile)
    const clips = await readRemotionClips(settings.baseDir)
    const readyFourByThree = clips.filter((clip) => clip.width === 1440 && clip.height === 1080 && clip.status === 'ready' && (clip.artifact?.fileSize ?? 0) > 100_000)
    const visualItems = (saved.timeline?.items ?? []).filter((item) => item.type === 'video' || item.type === 'image')
    const readyMediaIds = new Set(readyFourByThree.map((clip) => clip.artifact?.mediaId).filter(Boolean))
    return {
      projectUpdated: (saved.updatedAt ?? 0) > (before.updatedAt ?? 0),
      canvas: `${saved.metadata?.width}x${saved.metadata?.height}`,
      hasAnimatedRemotion: readyFourByThree.length > 0 && readyFourByThree.some((clip) => (clip.sourceRevision ?? 0) > beforeRevision),
      timelineUsesRenderedMedia: visualItems.some((item) => item.type === 'video' && readyMediaIds.has(item.mediaId)),
    }
  }, { timeout: 40 * 60_000, intervals: [5_000] }).toEqual({
    projectUpdated: true,
    canvas: '1440x1080',
    hasAnimatedRemotion: true,
    timelineUsesRenderedMedia: true,
  })

  await expect(input).toBeEnabled({ timeout: 40 * 60_000 })
  await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, projectFile, beforeRevision, finalClips: await readRemotionClips(settings.baseDir) }))
})
