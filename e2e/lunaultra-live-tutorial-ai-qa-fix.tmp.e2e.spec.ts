import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = 'iXBrE40P'
const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'

interface Item {
  id?: string
  type?: string
  text?: string
  mediaId?: string
  from?: number
  durationInFrames?: number
}

interface ProjectFile {
  updatedAt?: number
  metadata?: { width?: number; height?: number; fps?: number }
  timeline?: { items?: Item[] }
}

const prompt = `
请对当前已经完成的 LunaUltra 教程做一次最终画面 QA 和最小修复，不要重新渲染 Remotion，不要生成音频，不要改动画源码，也不要只回复说明。
先调用 luna.project.inspect() 和 luna.timeline.inspectContext()。最终合成画面在 0 到 11 秒已经由 Remotion 自带标题“UVC ≠ OBS”，字幕轨又有一条同样文字的标题，造成开头标题重复。请使用 inspect 返回的真实字幕 itemId，只删除这条重复的字幕片段；不要删除 Remotion 主视频、其他字幕、旁白或音乐。
删除后再次 inspect，确认项目仍为 1440×1080、只有一条从 0 秒开始且不超过 60 秒的主视频，音频仍是 5 段且在 0 到 60 秒内，字幕轨仍保留其他字幕和归一化位置转换后的 transform。不要调用 remotionRender 或任何时间线新增能力，保存项目并返回结构化检查结果。
`

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会调用真实 AI 助手')
test.setTimeout(10 * 60_000)

test('让内置 AI 助手修复最终合成中的重复标题', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const projectFile = path.join(baseDir, 'freecut-workspace', 'projects', projectId, 'project.json')
  await page.evaluate(async (settings) => window.luna.saveSettings(settings), {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: path.join(baseDir, 'export'),
  })
  await access(projectFile)

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible({ timeout: 30_000 })
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible({ timeout: 30_000 })

  const before = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
  const beforeVideos = (before.timeline?.items ?? []).filter((item) => item.type === 'video')
  const duplicate = (before.timeline?.items ?? []).find((item) => item.type === 'text' && item.text === 'UVC ≠ OBS')
  expect(duplicate?.id).toBeTruthy()

  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(panel.locator('iframe[title="DeepSeek Harness AI 助手"]')).toBeVisible({ timeout: 60_000 })
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
    const project = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
    const items = project.timeline?.items ?? []
    const videos = items.filter((item) => item.type === 'video')
    const audio = items.filter((item) => item.type === 'audio')
    const texts = items.filter((item) => item.type === 'text' || item.type === 'subtitle')
    return {
      canvas: `${project.metadata?.width}x${project.metadata?.height}`,
      updated: (project.updatedAt ?? 0) > (before.updatedAt ?? 0),
      duplicateRemoved: !texts.some((item) => item.id === duplicate?.id || item.text === 'UVC ≠ OBS'),
      videoUnchanged: videos.length === 1 && videos[0]?.mediaId === beforeVideos[0]?.mediaId && videos[0]?.from === 0,
      audioInBounds: audio.length === 5 && audio.every((item) =>
        (item.from ?? 0) >= 0 &&
        (item.durationInFrames ?? 0) > 1 &&
        (item.from ?? 0) + (item.durationInFrames ?? 0) <= 1800,
      ),
      otherTextRemains: texts.length >= 10,
    }
  }, { timeout: 8 * 60_000, intervals: [2_000] }).toEqual({
    canvas: '1440x1080',
    updated: true,
    duplicateRemoved: true,
    videoUnchanged: true,
    audioInBounds: true,
    otherTextRemains: true,
  })

  await expect(input).toBeEnabled({ timeout: 5 * 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
})
