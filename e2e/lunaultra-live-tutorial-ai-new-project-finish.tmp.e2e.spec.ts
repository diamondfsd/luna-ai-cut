import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = 'iXBrE40P'
const baseDir = '/Users/REDACTED/Pictures/LunaAI-Cut'

const prompt = `
请直接重新指挥 AI 完成当前项目的实际剪辑，不要新建项目，不要只回复方案。先调用 luna.project.inspect() 和 luna.timeline.inspectContext()，严格使用返回的真实项目、片段和轨道 ID；所有工具返回结果都要回传给模型，继续执行剩余步骤。

上一轮成片的问题是：字幕默认堆在画面中间，文字框太窄，画面没有铺满 4:3 画布，知识点内部也缺少跟随节点流动的动画。请在当前项目中重新设计并实际写回时间线：
1. 成片控制在 60 秒以内，主视觉只保留一条，从 0 秒开始；不要因为重新渲染而把新旧主视频同时留在时间线。
2. 重新检查 project.inspect() 返回的真实画布尺寸。主视觉必须覆盖整个画布，不要出现左右或上下黑边；RemotionClip 和最终主视觉必须使用 1440×1080 的 4:3 构图。保留并讲清：UVC 是设备协议、OBS 是软件出口；当前方案需要手机和电脑；树莓派类硬件接收 Luna Wi-Fi 并转换成 UVC，可 USB 连接手机或电脑；官方可能直接支持 UVC；Luna 直接推给 Insta360 App，再由抖音 SDK 开播。
3. 先用 video-shotcraft 的镜头卡思路重写一份 55 到 60 秒的紧凑脚本和画面节奏，然后必须使用 RemotionClip 重新设计动画并实际渲染成 MP4。每个知识点都要有连续动作，不要用静止信息卡：UVC/OBS 要有分层和数据流动；当前方案要有“手机 → Luna → 端口 → 电脑/OBS → 虚拟摄像头”的数据包逐节点经过和高亮；树莓派方案要有 Wi-Fi 接收、协议转换和 USB 双出口动画；官方两条路线要有链路缩短和节点逐步点亮的对比。源码更新后用 remotionUpdateSource + remotionRender，完成后把新 MP4 加入时间线并删除旧主视频、移动到 0 秒，再 inspect 确认。不要只生成 TTS、字幕或一张静态图。
4. 删除现有字幕后重新创建可读字幕/章节文字，字幕必须放在独立且高于主视觉的视频轨道，并与旁白时码对应。现在 luna.timeline.addText() 支持归一化位置：x/y 是文字框中心坐标，范围 0~1，原点在画布左上角；x: 0.5, y: 0.84 是底部居中，width: 0.84, height: 0.1 是占画布 84%×10%。每次 addText 都直接传入 x/y/width/height，不要让字幕默认居中，也不要把字幕放在主体脸部或节点动画上。字幕尽量一行短句，超长内容拆成两段，标题放在上方安全区，底部字幕放在 y: 0.84 附近。
5. 检查音频：只保留 0 到 60 秒内有效的旁白和音乐，删除超界或只有 1 帧的坏片段，不要截断最后一句。最终再次 inspect，确认只有一条主视频、4:3 视觉铺满、字幕位置分布合理、音频有效、Remotion 任务完成且没有工具错误。必须真正保存项目并返回结构化检查结果，不要提前宣告完成。

请直接执行全部重剪和保存，最后返回结构化检查结果，不要停下来让我确认。
`

interface Item {
  id?: string
  type?: string
  from?: number
  durationInFrames?: number
  mediaId?: string
  sourceWidth?: number
  sourceHeight?: number
  transform?: Record<string, unknown>
}

interface Project {
  id?: string
  metadata?: { width?: number; height?: number; fps?: number }
  updatedAt?: number
  timeline?: { items?: Item[] }
}

interface Clip {
  clipId?: string
  width?: number
  height?: number
  sourceRevision?: number
  sourceHash?: string
  status?: string
  artifact?: { fileSize?: number; mediaId?: string; sourceRevision?: number; sourceHash?: string }
}

async function readClips(projectRoot: string): Promise<Clip[]> {
  const clipsDir = path.join(projectRoot, 'remotion-clips')
  const entries = await readdir(clipsDir, { withFileTypes: true }).catch(() => [])
  const clips: Clip[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      clips.push(JSON.parse(await readFile(path.join(clipsDir, entry.name, 'clip.json'), 'utf8')) as Clip)
    } catch {
      // Ignore an in-progress clip directory.
    }
  }
  return clips
}

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会调用真实 AI 助手')
test.setTimeout(45 * 60_000)

test('让内置 AI 助手按归一化字幕坐标重做 LunaUltra 教程', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  await page.evaluate(async (settings) => window.luna.saveSettings(settings), {
    baseDir,
    localResourcesDir: path.join(baseDir, 'localResources'),
    exportDir: path.join(baseDir, 'export'),
  })

  const projectFile = path.join(baseDir, 'freecut-workspace', 'projects', projectId, 'project.json')
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
  const before = JSON.parse(await readFile(projectFile, 'utf8')) as Project
  const beforeVideos = (before.timeline?.items ?? []).filter((item) => item.type === 'video')
  const beforeMediaIds = new Set(beforeVideos.map((item) => item.mediaId).filter(Boolean))
  const beforeClipState = new Map(
    (await readClips(path.dirname(projectFile))).map((clip) => [
      clip.clipId,
      `${clip.sourceRevision ?? 0}:${clip.sourceHash ?? ''}:${clip.artifact?.mediaId ?? ''}`,
    ]),
  )

  await input.fill(prompt)
  await input.press('Enter')

  await expect.poll(async () => {
    const project = JSON.parse(await readFile(projectFile, 'utf8')) as Project
    const items = project.timeline?.items ?? []
    const videos = items.filter((item) => item.type === 'video')
    const audio = items.filter((item) => item.type === 'audio')
    const texts = items.filter((item) => item.type === 'text' || item.type === 'subtitle')
    const clips = await readClips(path.dirname(projectFile))
    const readyAnimatedClips = clips.filter((clip) =>
      clip.width === 1440 &&
      clip.height === 1080 &&
      clip.status === 'ready' &&
      (clip.artifact?.fileSize ?? 0) > 100_000 &&
      beforeClipState.get(clip.clipId) !== `${clip.sourceRevision ?? 0}:${clip.sourceHash ?? ''}:${clip.artifact?.mediaId ?? ''}`,
    )
    const renderedMediaIds = new Set(readyAnimatedClips.map((clip) => clip.artifact?.mediaId).filter(Boolean))
    const positionedTexts = texts.filter((item) => {
      const transform = item.transform
      return typeof transform?.x === 'number' &&
        typeof transform?.y === 'number' &&
        typeof transform?.width === 'number' &&
        typeof transform?.height === 'number' &&
        transform.width > 0 &&
        transform.height > 0
    })
    const inBoundsAudio = audio.length > 0 && audio.every((item) =>
      (item.from ?? 0) >= 0 &&
      (item.durationInFrames ?? 0) > 1 &&
      (item.from ?? 0) + (item.durationInFrames ?? 0) <= 1800,
    )
    return (project.updatedAt ?? 0) > (before.updatedAt ?? 0) &&
      videos.length === 1 &&
      videos[0]?.from === 0 &&
      (videos[0]?.durationInFrames ?? 0) > 0 &&
      (videos[0]?.durationInFrames ?? 0) <= 1800 &&
      !beforeMediaIds.has(videos[0]?.mediaId) &&
      renderedMediaIds.has(videos[0]?.mediaId) &&
      texts.length > 0 &&
      positionedTexts.length > 0 &&
      inBoundsAudio &&
      readyAnimatedClips.length > 0
  }, { timeout: 40 * 60_000, intervals: [5_000] }).toBe(true)

  await expect(input).toBeEnabled({ timeout: 10 * 60_000 })
  await expect(panel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors.filter((message) => /Maximum update depth|Minified React error #185|crashed/i.test(message))).toEqual([])
  console.log(JSON.stringify({ projectId, projectFile, project: JSON.parse(await readFile(projectFile, 'utf8')) }))
})
