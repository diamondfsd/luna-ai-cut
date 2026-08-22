import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = 'TnPSuAWd'
const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'
const prompt = `
请直接在当前 FreeCut 项目完成时间线收尾，不要只回复说明。先调用 luna.project.inspect() 和 luna.timeline.inspectContext()，使用返回的真实片段 ID。

刚刚已经生成了新的 4:3 动画 Remotion 视频并加入视频轨，但当前时间线错误地同时保留了旧视觉视频，并把新视频追加到了 90 秒之后。请修复为最终 90 秒成片：
1. 识别当前视频轨中旧的视觉片段和新的 Remotion 动画片段。新的片段应当是刚刚渲染出的 1440×1080、90 秒视频，媒体 ID 通常以 remotion-clip-9ffc9a3e-c4b4-402f-ade5-687676e12648-6 结尾，但必须以 inspect 返回的真实 ID 为准。
2. 删除旧的视觉视频片段，只删除旧视频片段本身，不要删除旁白、背景音乐、章节字幕或其他轨道。
3. 用 luna.timeline.move() 把新的动画片段移动到 0 秒，并保留在 id-video 轨道；不要再 addMedia，不要再次渲染。
4. 再次调用 luna.timeline.inspectContext()，确认视频轨只有一个 0 到 90 秒的视频片段，音频仍然是原来的 5 段，字幕仍然保留，项目画布仍然是 1440×1080。
完成后保存项目并返回结构化检查结果。
`

interface Item { id?: string; type?: string; mediaId?: string; from?: number; durationInFrames?: number }
interface Project { id?: string; metadata?: { width?: number; height?: number }; timeline?: { items?: Item[] }; updatedAt?: number }

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(15 * 60_000)

test('让内置 AI 助手清理动画版时间线并保持九十秒结构', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.evaluate(async (settings) => window.luna.saveSettings(settings), {
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
  await input.fill(prompt)
  await input.press('Enter')

  await expect.poll(async () => {
    const project = JSON.parse(await readFile(projectFile, 'utf8')) as Project
    const items = project.timeline?.items ?? []
    const videos = items.filter((item) => item.type === 'video')
    return {
      canvas: `${project.metadata?.width}x${project.metadata?.height}`,
      videoCount: videos.length,
      videoAtZero: videos.length === 1 && videos[0].from === 0 && videos[0].durationInFrames === 2700,
      audioCount: items.filter((item) => item.type === 'audio').length,
      textCount: items.filter((item) => item.type === 'text').length,
      hasNewMedia: videos.some((item) => item.mediaId?.endsWith('-6')),
    }
  }, { timeout: 10 * 60_000, intervals: [5_000] }).toEqual({
    canvas: '1440x1080',
    videoCount: 1,
    videoAtZero: true,
    audioCount: 5,
    textCount: 4,
    hasNewMedia: true,
  })

  await expect(input).toBeEnabled({ timeout: 10 * 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, projectFile, project: JSON.parse(await readFile(projectFile, 'utf8')) }))
})
