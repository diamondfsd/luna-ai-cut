import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = 'iXBrE40P'
const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'

interface ProjectItem {
  id?: string
  type?: string
  mediaId?: string
  from?: number
  durationInFrames?: number
}

interface ProjectFile {
  updatedAt?: number
  metadata?: { width?: number; height?: number; fps?: number }
  timeline?: { items?: ProjectItem[] }
}

const prompt = `
请只完成当前项目的画布收尾，不要重新设计、重新渲染 Remotion，不要生成 TTS，不要删除或重建任何时间线片段，也不要只回复说明。
先调用 luna.project.inspect() 和 luna.timeline.inspectContext()，使用返回的真实项目和片段 ID。当前主视觉已经是 1440×1080 的 60 秒 Remotion 动画，但项目根画布仍可能是 1920×1080。
请调用 luna.project.update({ canvas: { width: 1440, height: 1080, fps: 30 } })，把项目根画布持久化为 4:3；然后再次调用 project.inspect() 和 timeline.inspectContext() 复核：只有一条主视频且从 0 秒开始、视频不超过 60 秒，字幕轨道仍在视频轨道上方并保留归一化位置转换后的 transform，五段有效音频仍在 0 到 60 秒内。不要调用任何重新渲染或时间线修改能力，最后返回结构化检查结果并保存项目。
`

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会调用真实 AI 助手')
test.setTimeout(12 * 60_000)

test('让内置 AI 助手持久化 LunaUltra 教程的 4:3 画布', async ({ lunaLiveApp }) => {
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
  const beforeVideoIds = (before.timeline?.items ?? [])
    .filter((item) => item.type === 'video')
    .map((item) => item.mediaId)

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
    const project = JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
    const items = project.timeline?.items ?? []
    const videos = items.filter((item) => item.type === 'video')
    const audio = items.filter((item) => item.type === 'audio')
    const texts = items.filter((item) => item.type === 'text' || item.type === 'subtitle')
    return {
      canvas: `${project.metadata?.width}x${project.metadata?.height}`,
      updated: (project.updatedAt ?? 0) > (before.updatedAt ?? 0),
      oneVideo: videos.length === 1 && videos[0]?.from === 0 && (videos[0]?.durationInFrames ?? 0) <= 1800,
      videoUnchanged: videos.length === 1 && beforeVideoIds.includes(videos[0]?.mediaId),
      audioInBounds: audio.length === 5 && audio.every((item) =>
        (item.from ?? 0) >= 0 &&
        (item.durationInFrames ?? 0) > 1 &&
        (item.from ?? 0) + (item.durationInFrames ?? 0) <= 1800,
      ),
      hasText: texts.length > 0,
    }
  }, { timeout: 10 * 60_000, intervals: [2_000] }).toEqual({
    canvas: '1440x1080',
    updated: true,
    oneVideo: true,
    videoUnchanged: true,
    audioInBounds: true,
    hasText: true,
  })

  await expect(input).toBeEnabled({ timeout: 5 * 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, projectFile, project: JSON.parse(await readFile(projectFile, 'utf8')) }))
})
