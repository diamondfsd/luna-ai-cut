import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegPath from 'ffmpeg-static'

import { expect, test, type LunaElectronApp } from './fixtures/lunaElectron'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(import.meta.dirname, '..')
const supportRoot = path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'luna-ai-cut', 'models')
const modelSources = [
  ['face-parsing-resnet18', process.env.LUNA_E2E_FACE_PARSING_MODEL_PATH
    ?? path.join(supportRoot, 'face-parsing-resnet18', 'model.onnx')],
  ['schp-atr-resnet101-512', process.env.LUNA_E2E_HUMAN_PARSING_MODEL_PATH
    ?? path.join(supportRoot, 'schp-atr-resnet101-512', 'model.onnx')],
  ['ultraface-rfb-320', process.env.LUNA_E2E_ULTRAFACE_MODEL_PATH
    ?? path.join(supportRoot, 'ultraface-rfb-320', 'model.onnx')],
] as const
const modelsAvailable = modelSources.every(([, source]) => existsSync(source))

async function installBeautyModels(lunaApp: LunaElectronApp): Promise<void> {
  const modelRoot = path.join(lunaApp.temporaryRoot, 'user-data', 'models')
  await Promise.all(modelSources.map(async ([id, source]) => {
    const directory = path.join(modelRoot, id)
    await mkdir(directory, { recursive: true })
    await copyFile(source, path.join(directory, 'model.onnx'))
  }))
}

async function openVideoProject(lunaApp: LunaElectronApp): Promise<{ id: string; projectFile: string; duration: number }> {
  if (!ffmpegPath) throw new Error('测试视频生成工具不可用')
  const fixtureDir = path.join(lunaApp.temporaryRoot, 'fixtures')
  const videoPath = path.join(fixtureDir, 'video-beauty-input.mp4')
  await mkdir(fixtureDir, { recursive: true })
  if (process.env.LUNA_E2E_BEAUTY_VIDEO_PATH) {
    await copyFile(process.env.LUNA_E2E_BEAUTY_VIDEO_PATH, videoPath)
  } else {
    const imagePath = process.env.LUNA_E2E_BEAUTY_INPUT_PATH
      ?? path.join(projectRoot, 'test-data', 'color-masking', 'd3-effect-set', 'images', 'person', 'person-04.jpg')
    await execFileAsync(ffmpegPath, [
      '-y', '-v', 'error', '-loop', '1', '-i', imagePath,
      '-t', '4.2', '-r', '6', '-vf', 'scale=640:-2:flags=lanczos,format=yuv420p',
      '-c:v', 'libx264', '-an', videoPath,
    ])
  }
  const projectName = `视频美颜 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, filePath }) => (
    window.luna.workspace.createProject(name, [{
      id: 'video-beauty-input', name: 'video-beauty-input.mp4', path: filePath, kind: 'video',
    }])
  ), { name: projectName, filePath: videoPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 1 个素材`, exact: true }).click()
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })
  const duration = await lunaApp.page.evaluate((filePath) => window.luna.workspace.getVideoDuration(filePath), videoPath)
  return {
    id: project.id,
    projectFile: path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json'),
    duration,
  }
}

test('视频美颜支持边分析边调整并完整导出', async ({ lunaApp }) => {
  test.setTimeout(240_000)
  test.skip(!modelsAvailable, '需要提供面部、人体和人脸检测 ONNX 模型')

  await installBeautyModels(lunaApp)
  const { projectFile, duration } = await openVideoProject(lunaApp)
  await lunaApp.page.getByRole('button', { name: '美颜', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '识别整段视频', exact: true }).click()

  const status = lunaApp.page.locator('.beauty-analysis-status')
  await expect(status).toBeVisible()
  await expect(lunaApp.page.getByText('已完成区域可预览和调整', { exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(status).toBeVisible()
  await expect(lunaApp.page.locator('[aria-label^="美颜模型准备进度"]')).toBeVisible()

  await expect.poll(async () => {
    const partial = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { beautyMasks?: Array<{ timeline?: { frames: unknown[] } }> } }>
    }
    return partial.assets[0]?.pipeline?.beautyMasks?.find((layer) => layer.timeline)?.timeline?.frames.length ?? 0
  }).toBeGreaterThan(0)
  const partial = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: { beautyMasks?: Array<{ timeline?: { endTime: number } }> } }>
  }
  const partialTimeline = partial.assets[0]?.pipeline?.beautyMasks?.find((layer) => layer.timeline)?.timeline
  expect(partialTimeline?.endTime).toBeLessThan(duration)

  await lunaApp.page.getByRole('button', { name: '测试蒙版', exact: true }).click()
  await expect(lunaApp.page.getByTestId('beauty-mask-overlay')).toBeVisible()
  const parameterValues = [40, 25, 55, 35]
  const parameterLabels = ['面部美白数值', '皮肤美白数值', '磨皮数值', '质感数值']
  for (let index = 0; index < parameterLabels.length; index += 1) {
    const input = lunaApp.page.getByLabel(parameterLabels[index])
    await input.fill(String(parameterValues[index]))
    await input.blur()
  }
  await expect(status).toBeHidden({ timeout: 180_000 })
  await expect(lunaApp.page.getByRole('button', { name: '重试识别', exact: true })).toHaveCount(0)
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { beautyMasks?: Array<{ timeline?: { endTime: number } }> } }>
    }
    return saved.assets[0]?.pipeline?.beautyMasks?.find((layer) => layer.timeline)?.timeline?.endTime ?? 0
  }).toBeCloseTo(duration, 2)

  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: { beautyMasks?: Array<{
      id: string
      path: string
      width: number
      height: number
      color: { exposure: number; denoise: number; texture: number }
      timeline?: { endTime: number; frames: Array<{
        time: number
        path?: string
        transform?: { translateX: number; translateY: number; scale: number; rotation: number; confidence: number }
      }> }
    }> } }>
  }
  const layers = persisted.assets[0]?.pipeline?.beautyMasks ?? []
  const face = layers.find((layer) => layer.id === 'beauty-face-skin')
  const body = layers.find((layer) => layer.id === 'beauty-body-skin')
  expect(layers).toHaveLength(2)
  expect(face).toMatchObject({ width: 512, height: 512, color: { exposure: 0.068, denoise: 55, texture: 35 } })
  expect(body).toMatchObject({ width: 512, height: 512, color: { exposure: 0.02 } })
  expect(face?.timeline?.frames.length).toBeGreaterThanOrEqual(Math.max(1, Math.floor(duration / 0.125 * 0.7)))
  expect(body?.timeline?.frames.length).toBe(face?.timeline?.frames.length)
  expect(face?.timeline?.endTime).toBeCloseTo(duration, 2)
  const trackedFrames = face?.timeline?.frames.filter((frame) => frame.transform && frame.transform.confidence > 0) ?? []
  expect(trackedFrames.length).toBeGreaterThan(1)
  const uniqueFacePaths = new Set(face?.timeline?.frames.map((frame) => frame.path).filter(Boolean))
  expect(uniqueFacePaths.size).toBeLessThan(face?.timeline?.frames.length ?? 0)
  for (const maskPath of new Set([
    ...(face?.timeline?.frames.map((frame) => frame.path).filter(Boolean) ?? []),
    ...(body?.timeline?.frames.map((frame) => frame.path).filter(Boolean) ?? []),
  ] as string[])) {
    const pgm = await readFile(maskPath)
    expect(pgm.subarray(0, pgm.indexOf('\n255\n') + 5).toString('ascii')).toContain('512 512')
  }

  await lunaApp.page.getByRole('button', { name: '关闭蒙版', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '导出', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '确认导出', exact: true }).click()
  await expect(lunaApp.page.getByText('已加入导出队列: 1 个结果', { exact: true })).toBeVisible()

  const completed = await expect.poll(async () => lunaApp.page.evaluate(async () => {
    const tasks = await window.luna.exportTask.list()
    const task = tasks.find((candidate) => candidate.name === '工作台混合导出')
    return task ? { status: task.status, outputPath: task.items[0]?.destinationPath, error: task.items[0]?.error } : null
  }), { timeout: 120_000 }).toMatchObject({ status: 'completed', outputPath: expect.any(String) })
  void completed
  const tasks = await lunaApp.page.evaluate(() => window.luna.exportTask.list())
  const outputPath = tasks.find((task) => task.name === '工作台混合导出')?.items[0]?.destinationPath
  expect(outputPath).toBeTruthy()
  expect((await stat(outputPath!)).size).toBeGreaterThan(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
