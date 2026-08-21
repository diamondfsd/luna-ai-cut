import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectronLive'

const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'MShH08dL'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(12 * 60_000)

interface ProjectEffect {
  id?: string
  type?: string
  gpuEffectType?: string
  params?: Record<string, unknown>
  enabled?: boolean
  effect?: {
    type?: string
    gpuEffectType?: string
    params?: Record<string, unknown>
  }
}

interface ProjectItem {
  id: string
  type: string
  from: number
  durationInFrames: number
  effects?: ProjectEffect[]
  visualEffects?: ProjectEffect[]
}

interface ProjectFile {
  id?: string
  fps?: number
  timeline?: { items?: ProjectItem[] }
}

async function readProject(projectFile: string): Promise<ProjectFile> {
  return JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
}

function visualItems(project: ProjectFile): ProjectItem[] {
  return (project.timeline?.items ?? []).filter((item) => item.type === 'image' || item.type === 'video')
}

function effectsFor(item: ProjectItem): ProjectEffect[] {
  return item.effects ?? item.visualEffects ?? []
}

function effectType(effect: ProjectEffect): string | undefined {
  return effect.effect?.gpuEffectType
    ?? effect.gpuEffectType
    ?? (effect.effect?.type === 'gpu-effect' ? undefined : effect.effect?.type)
    ?? (effect.type === 'gpu-effect' ? undefined : effect.type)
}

function effectParams(effect: ProjectEffect): Record<string, unknown> {
  return effect.effect?.params ?? effect.params ?? {}
}

test('强化王家卫风格暗部和动作慢门并核验落盘', async ({ lunaLiveApp }) => {
  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const projectFile = path.join(
    settings.baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const before = await readProject(projectFile)
  const beforeVisualIds = new Set(visualItems(before).map((item) => item.id))
  expect(beforeVisualIds.size).toBeGreaterThanOrEqual(2)

  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistantPanel).toBeVisible()
  const harnessFrameElement = assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(harnessFrameElement).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')
  const input = harness.locator('textarea:enabled').last()
  await expect(input).toBeVisible({ timeout: 60_000 })

  await input.fill([
    '请基于当前项目已经完成的王家卫式短片，只强化画面效果，保持现有镜头顺序、片段起止时间、速度、转场、字幕、音乐和音频不变。',
    '先调用 luna.project.inspect() 和 luna.timeline.inspectContext()，使用返回的真实视频片段 ID。',
    '请对当前时间线上的每个视频片段更新或补齐以下效果；同一片段已有同类型效果时必须 update，不要重复添加：gpu-brightness amount -0.12，gpu-contrast amount 1.45，gpu-saturation amount 1.22，gpu-vignette amount 0.55、size 0.55、softness 0.42、roundness 1，gpu-grain amount 0.08、size 1.5、speed 1。',
    '只在中间的蹦床动作视频片段上更新或添加一个 gpu-motion-blur，参数为 amount 0.3、angle 0.2、shutterAngle 360、samples 28；不要给其他片段添加 motion blur。',
    '每组效果写入后重新调用 luna.timeline.inspectContext()，最后再次检查时间线并保存项目。不要创建新素材，不要重做剪辑。',
  ].join('\n'))
  await input.press('Enter')

  await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  await expect.poll(async () => {
    const saved = await readProject(projectFile)
    const savedVisuals = visualItems(saved)
    return {
      hasAllOriginalVisuals: savedVisuals.every((item) => beforeVisualIds.has(item.id)),
      hasStrongGrade: savedVisuals.every((item) => {
        const effectMap = new Map(effectsFor(item).map((effect) => [effectType(effect), effect]))
        return effectParams(effectMap.get('gpu-brightness') ?? {}).amount === -0.12
          && effectParams(effectMap.get('gpu-contrast') ?? {}).amount === 1.45
          && effectParams(effectMap.get('gpu-vignette') ?? {}).amount === 0.55
      }),
      hasMotionBlur: savedVisuals.some((item) => effectsFor(item).some((effect) =>
        effectType(effect) === 'gpu-motion-blur'
        && effectParams(effect).amount === 0.3
        && effectParams(effect).shutterAngle === 360
        && effectParams(effect).samples === 28,
      )),
    }
  }, { timeout: 10 * 60_000 }).toEqual({
    hasAllOriginalVisuals: true,
    hasStrongGrade: true,
    hasMotionBlur: true,
  })

  await expect(input).toBeEnabled({ timeout: 10 * 60_000 })
  await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})
