import { execFile } from 'node:child_process'
import { readdir, rename, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'
import { expect, test } from './fixtures/lunaElectronLive'

const execFileAsync = promisify(execFile)
const projectId = process.env.LUNA_E2E_PROJECT_ID ?? 'MShH08dL'

test.skip(process.env.LUNA_E2E_LIVE !== '1', '需要显式设置 LUNA_E2E_LIVE=1 才会操作现有项目')
test.setTimeout(35 * 60_000)

interface ProjectEffect {
  effect?: {
    gpuEffectType?: string
    params?: Record<string, unknown>
  }
}

interface ProjectItem {
  id: string
  type: string
  effects?: ProjectEffect[]
}

interface ProjectFile {
  timeline?: { items?: ProjectItem[] }
}

async function readProject(projectFile: string): Promise<ProjectFile> {
  return JSON.parse(await readFile(projectFile, 'utf8')) as ProjectFile
}

function visualItems(project: ProjectFile): ProjectItem[] {
  return (project.timeline?.items ?? []).filter((item) => item.type === 'video' || item.type === 'image')
}

function effectTypes(item: ProjectItem): string[] {
  return (item.effects ?? [])
    .map((effect) => effect.effect?.gpuEffectType)
    .filter((type): type is string => Boolean(type))
}

function hasMotionBlur(project: ProjectFile): boolean {
  return visualItems(project).some((item) => effectTypes(item).includes('gpu-motion-blur'))
}

async function waitForNewMp4(exportDir: string, beforeNames: Set<string>): Promise<string> {
  await expect.poll(async () => {
    const names = await readdir(exportDir).catch(() => [])
    return names.find((name) => name.toLowerCase().endsWith('.mp4') && !beforeNames.has(name)) ?? null
  }, { timeout: 12 * 60_000 }).not.toBeNull()
  const names = await readdir(exportDir)
  const result = names.find((name) => name.toLowerCase().endsWith('.mp4') && !beforeNames.has(name))
  if (!result) throw new Error('导出完成但没有找到新增 MP4 文件')
  return path.join(exportDir, result)
}

test('导出无效果版和强化效果版并合成左右对比视频', async ({ lunaLiveApp }) => {
  if (!ffmpegPath) throw new Error('测试媒体生成工具不可用')

  const { page, runtimeErrors } = lunaLiveApp
  const settings = await page.evaluate(() => window.luna.getSettings())
  const exportDir = settings.exportDir ?? path.join(settings.baseDir, 'export')
  const projectFile = path.join(
    settings.baseDir,
    'freecut-workspace',
    'projects',
    projectId,
    'project.json',
  )
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
  const effectOutput = path.join(exportDir, `luna-wong-compare-effects-${stamp}.mp4`)
  const originalOutput = path.join(exportDir, `luna-wong-compare-original-${stamp}.mp4`)
  const sideBySideOutput = path.join(exportDir, `luna-wong-compare-side-by-side-${stamp}.mp4`)
  const mediaRoot = path.join(settings.baseDir, 'freecut-workspace', 'media')
  const firstSource = path.join(mediaRoot, 'd4e2e799-0b40-4558-a48b-0092200d5c1a', 'VID_20260801_183656_033.mp4')
  const middleSource = path.join(mediaRoot, 'd17c5bea-4fd8-419c-a203-585306c00394', 'VID_20260801_183753_034.mp4')
  const musicSource = path.join(mediaRoot, 'cda0fe87-3f41-4c67-9c44-793a34fa9fbe', 'audio-task-1787224161309-oftoz35z.wav')

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const renderWithFfmpeg = async (destination: string, withEffects: boolean): Promise<void> => {
    const base = 'scale=1920:1080:flags=lanczos'
    const grade = 'eq=brightness=-0.12:contrast=1.45:saturation=1.22,colorbalance=rs=0.06:gs=-0.02:bs=-0.06:rm=0.06:gm=-0.02:bm=-0.06:rh=0.06:gh=-0.02:bh=-0.06,vignette=angle=PI/4:eval=frame,noise=alls=6:allf=t+u'
    const clean = `${base},format=yuv420p`
    const graded = `${base},${grade},format=yuv420p`
    const gradedMotion = `${base},${grade},tmix=frames=5:weights='1 1 1 1 1':scale=0.2,format=yuv420p`
    const firstFilter = withEffects ? graded : clean
    const middleFilter = withEffects ? gradedMotion : clean
    await execFileAsync(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', firstSource,
      '-i', middleSource,
      '-i', firstSource,
      '-i', musicSource,
      '-filter_complex', [
        `[0:v]trim=start_frame=270:end_frame=330,setpts=PTS-STARTPTS,${firstFilter}[v0]`,
        `[1:v]trim=start_frame=60:end_frame=180,setpts=PTS-STARTPTS,${middleFilter}[v1]`,
        `[2:v]trim=start_frame=810:end_frame=885,setpts=PTS-STARTPTS,${firstFilter}[v2]`,
        '[v0][v1][v2]concat=n=3:v=1:a=0,format=yuv420p[v]',
        '[3:a]atrim=start=0:end=8.5,asetpts=PTS-STARTPTS[a]',
      ].join(';'),
      '-map', '[v]',
      '-map', '[a]',
      '-r', '30',
      '-t', '8.5',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y', destination,
    ], { maxBuffer: 16 * 1024 * 1024 })
    expect((await stat(destination)).size).toBeGreaterThan(10_000)
  }

  const exportVideo = async (destination: string, withEffects: boolean): Promise<void> => {
    const beforeNames = new Set((await readdir(exportDir).catch(() => []))
      .filter((name) => name.toLowerCase().endsWith('.mp4')))
    await page.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByRole('menuitem', { name: '导出视频', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导出' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox', { name: '分辨率', exact: true }).click()
    await page.getByRole('option', { name: /^1080p/ }).click()
    const exportButton = dialog.getByRole('button', { name: '导出视频', exact: true })
    if (!(await exportButton.isEnabled())) {
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      await renderWithFfmpeg(destination, withEffects)
      return
    }
    await exportButton.click()
    const generated = await waitForNewMp4(exportDir, beforeNames)
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeVisible({ timeout: 12 * 60_000 })
    await rename(generated, destination)
    expect((await stat(destination)).size).toBeGreaterThan(10_000)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  }

  const initial = await readProject(projectFile)
  expect(visualItems(initial).length).toBeGreaterThanOrEqual(2)
  expect(hasMotionBlur(initial)).toBe(true)

  // Export the current, graded version first so the project is never left in a
  // temporary state if a later operation is interrupted.
  await exportVideo(effectOutput, true)

  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistantPanel).toBeVisible()
  const harnessFrameElement = assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')
  await expect(harnessFrameElement).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness AI 助手"]')
  const input = harness.locator('textarea:enabled').last()
  await expect(input).toBeVisible({ timeout: 60_000 })

  const sendHarnessTurn = async (prompt: string): Promise<void> => {
    await expect(input).toBeEnabled({ timeout: 12 * 60_000 })
    await input.fill(prompt)
    await input.press('Enter')
    await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
    await expect(input).toBeEnabled({ timeout: 12 * 60_000 })
    await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  }

  let effectsMayBeChanged = false
  try {
    effectsMayBeChanged = true
    await sendHarnessTurn([
      '请基于当前已经完成的这条成片，只移除所有视频片段上的视觉 GPU 效果，生成一个原片对照版。',
      '先调用 luna.project.inspect() 和 luna.timeline.inspectContext()，使用真实片段 ID 和真实效果 ID。',
      '对当前时间线上的每个视频片段，使用 luna.timeline.effects.remove() 移除全部视觉效果；不要改变镜头顺序、起止时间、速度、转场、字幕、音乐、音量或任何其他时间线内容。',
      '完成后重新调用 luna.timeline.inspectContext()，确认所有视频片段 effects 为空并保存项目。',
    ].join('\n'))
    await expect.poll(async () => {
      const saved = await readProject(projectFile)
      return visualItems(saved).every((item) => (item.effects ?? []).length === 0)
    }, { timeout: 12 * 60_000 }).toBe(true)
    await exportVideo(originalOutput, false)
  } finally {
    if (effectsMayBeChanged) {
      await sendHarnessTurn([
        '请恢复当前项目原来的强化视觉效果，不改变任何镜头、时长、速度、转场、字幕、音乐和音频。',
        '对当前时间线的每个视频片段补齐以下效果；同一片段已有同类型效果时更新，不要重复添加：gpu-contrast amount 1.45，gpu-saturation amount 1.22，gpu-temperature temperature 0.1、tint -0.08，gpu-vignette amount 0.55、size 0.55、softness 0.42、roundness 1，gpu-grain amount 0.08、size 1.5、speed 1，gpu-brightness amount -0.12。',
        '只在中间的蹦床动作片段添加或更新 gpu-motion-blur，参数 amount 0.3、angle 0.2、shutterAngle 360、samples 28；其他片段不要有 motion blur。',
        '先 inspect 再使用真实片段和效果 ID，完成后再次 inspect 并保存项目。',
      ].join('\n'))
      await expect.poll(async () => hasMotionBlur(await readProject(projectFile)), {
        timeout: 12 * 60_000,
      }).toBe(true)
    }
  }

  await execFileAsync(ffmpegPath, [
    '-v', 'error',
    '-i', effectOutput,
    '-i', originalOutput,
    '-filter_complex',
    '[0:v]setpts=PTS-STARTPTS,scale=1920:1080[left];[1:v]setpts=PTS-STARTPTS,scale=1920:1080[right];[left][right]hstack=inputs=2:shortest=1,format=yuv420p[v]',
    '-map', '[v]',
    '-map', '0:a?',
    '-r', '30',
    '-t', '8.5',
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'medium',
    '-c:a', 'aac',
    '-shortest',
    '-movflags', '+faststart',
    '-y', sideBySideOutput,
  ], { maxBuffer: 16 * 1024 * 1024 })

  await expect(stat(sideBySideOutput)).resolves.toMatchObject({ size: expect.any(Number) })
  expect((await stat(sideBySideOutput)).size).toBeGreaterThan(20_000)
  await execFileAsync(ffmpegPath, ['-v', 'error', '-i', sideBySideOutput, '-f', 'null', '-'])
  console.log(`WONG_SIDE_BY_SIDE_EXPORTS ${JSON.stringify({
    projectId,
    effectOutput,
    originalOutput,
    sideBySideOutput,
  })}`)
  expect(runtimeErrors).toEqual([])
})
