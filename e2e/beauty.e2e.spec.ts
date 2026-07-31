import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type LunaElectronApp } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')
const supportRoot = path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'luna-ai-cut', 'models')
const models = {
  face: [
    process.env.LUNA_E2E_FACE_PARSING_MODEL_PATH,
    path.join(supportRoot, 'face-parsing-resnet18', 'model.onnx'),
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))),
  humanParsing: [
    process.env.LUNA_E2E_HUMAN_PARSING_MODEL_PATH,
    path.join(supportRoot, 'schp-atr-18-int8', 'model.onnx'),
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))),
  faceDetector: [
    process.env.LUNA_E2E_ULTRAFACE_MODEL_PATH,
    path.join(supportRoot, 'ultraface-rfb-320', 'model.onnx'),
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))),
}

async function installBeautyModels(lunaApp: LunaElectronApp): Promise<void> {
  const modelRoot = path.join(lunaApp.temporaryRoot, 'user-data', 'models')
  await Promise.all([
    ['face-parsing-resnet18', models.face!],
    ['schp-atr-18-int8', models.humanParsing!],
    ['ultraface-rfb-320', models.faceDetector!],
  ].map(async ([id, source]) => {
    const directory = path.join(modelRoot, id)
    await mkdir(directory, { recursive: true })
    await copyFile(source, path.join(directory, 'model.onnx'))
  }))
}

async function openBeautyFixture(lunaApp: LunaElectronApp, fixtureSource: string): Promise<{
  project: { id: string }
  projectName: string
}> {
  const fixtureDir = path.join(lunaApp.temporaryRoot, 'fixtures')
  const inputPath = path.join(fixtureDir, `beauty-input${path.extname(fixtureSource) || '.jpg'}`)
  await mkdir(fixtureDir, { recursive: true })
  await copyFile(fixtureSource, inputPath)
  const projectName = `美颜 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, filePath }) => (
    window.luna.workspace.createProject(name, [{ id: 'beauty-input', name: 'beauty-input.jpg', path: filePath, kind: 'image' }])
  ), { name: projectName, filePath: inputPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 1 个素材`, exact: true }).click()
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })
  return { project, projectName }
}

test('图片美颜识别人脸与身体皮肤并持久化参数', async ({ lunaApp }) => {
  test.skip(!models.face || !models.humanParsing || !models.faceDetector, '需要提供面部、人体和人脸检测 ONNX 模型')

  await installBeautyModels(lunaApp)
  const fixtureSource = process.env.LUNA_E2E_BEAUTY_INPUT_PATH
    ?? path.join(projectRoot, 'test-data', 'color-masking', 'd3-effect-set', 'images', 'person', 'person-04.jpg')
  const { project } = await openBeautyFixture(lunaApp, fixtureSource)
  const screenshotDir = process.env.LUNA_E2E_BEAUTY_SCREENSHOT_DIR
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true })
    await lunaApp.page.locator('.preview-stage').screenshot({ path: path.join(screenshotDir, 'beauty-original.png') })
  }
  await lunaApp.page.getByRole('button', { name: '美颜', exact: true }).click()

  await expect(lunaApp.page.getByLabel('面部美白数值')).toHaveValue('18', { timeout: 120_000 })
  await expect(lunaApp.page.getByRole('button', { name: '重试识别', exact: true })).toHaveCount(0)
  await expect(lunaApp.page.getByLabel('皮肤整体美白数值')).toHaveValue('10')
  await expect(lunaApp.page.getByLabel('磨皮数值')).toHaveValue('28')
  const setBeautyValues = async (face: number, skin: number, smoothing: number) => {
    await lunaApp.page.getByLabel('面部美白数值').fill(String(face))
    await lunaApp.page.getByLabel('面部美白数值').blur()
    await lunaApp.page.getByLabel('皮肤整体美白数值').fill(String(skin))
    await lunaApp.page.getByLabel('皮肤整体美白数值').blur()
    await lunaApp.page.getByLabel('磨皮数值').fill(String(smoothing))
    await lunaApp.page.getByLabel('磨皮数值').blur()
    await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })
  }
  const captureBeauty = async (name: string) => {
    if (!screenshotDir) return
    await lunaApp.page.locator('.preview-stage').screenshot({ path: path.join(screenshotDir, name) })
  }
  if (screenshotDir) {
    await setBeautyValues(0, 0, 0)
    await captureBeauty('beauty-zero.png')
    await setBeautyValues(100, 0, 0)
    await captureBeauty('beauty-face-whitening-100.png')
    await setBeautyValues(0, 100, 0)
    await captureBeauty('beauty-skin-whitening-100.png')
    await setBeautyValues(0, 0, 100)
    await captureBeauty('beauty-smoothing-100.png')
  }
  await setBeautyValues(100, 100, 100)

  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { colorMasks?: Array<{
        id: string
        path: string
        modelId: string
        color: { exposure: number; brightness: number; denoise: number }
      }> } }>
    }
    const layers = persisted.assets[0]?.pipeline?.colorMasks ?? []
    const face = layers.find((layer) => layer.id === 'beauty-face-skin')
    const body = layers.find((layer) => layer.id === 'beauty-body-skin')
    return {
      count: layers.filter((layer) => layer.id.startsWith('beauty-')).length,
      faceExposure: face?.color.exposure,
      faceBrightness: face?.color.brightness,
      faceDenoise: face?.color.denoise,
      bodyExposure: body?.color.exposure,
      bodyBrightness: body?.color.brightness,
      faceModelId: face?.modelId,
      bodyModelId: body?.modelId,
      paths: [face?.path, body?.path].filter(Boolean),
    }
  }).toMatchObject({
    count: 2,
    faceExposure: 0.45,
    faceBrightness: 0,
    faceDenoise: 100,
    bodyExposure: 0.15,
    bodyBrightness: 0,
    faceModelId: 'face-parsing-resnet18',
    bodyModelId: 'schp-atr-18-int8',
    paths: expect.any(Array),
  })

  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: { colorMasks?: Array<{ id: string; path: string }> } }>
  }
  const beautyMasks = (persisted.assets[0]?.pipeline?.colorMasks ?? [])
    .filter((layer) => layer.id.startsWith('beauty-'))
  expect(beautyMasks).toHaveLength(2)
  for (const mask of beautyMasks) {
    expect((await stat(mask.path)).size).toBeGreaterThan(0)
    const pgm = await readFile(mask.path)
    const dataStart = pgm.indexOf('\n255\n') + 5
    expect(dataStart).toBeGreaterThan(4)
    expect(pgm.subarray(0, dataStart).toString('ascii')).toContain('1024 1024')
    expect(pgm.subarray(dataStart).some((value) => value >= 128), `${mask.id} 应包含有效皮肤像素`).toBe(true)
    expect(
      pgm.subarray(dataStart).some((value) => value > 0 && value < 255),
      `${mask.id} 应包含渐变边缘`,
    ).toBe(true)
    if (screenshotDir) await copyFile(mask.path, path.join(screenshotDir, `${mask.id}.pgm`))
  }
  if (screenshotDir) {
    await lunaApp.page.locator('.preview-stage').screenshot({ path: path.join(screenshotDir, 'beauty-max.png') })
  }
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('图片美颜没有检测到人脸时仍提供参数且保持空效果', async ({ lunaApp }) => {
  test.skip(!models.face || !models.humanParsing || !models.faceDetector, '需要提供面部、人体和人脸检测 ONNX 模型')
  await installBeautyModels(lunaApp)
  const fixtureSource = path.join(
    projectRoot,
    'test-data',
    'color-masking',
    'd3-effect-set',
    'images',
    'person',
    'person-01.jpg',
  )
  const { project } = await openBeautyFixture(lunaApp, fixtureSource)
  await lunaApp.page.getByRole('button', { name: '美颜', exact: true }).click()
  await expect(lunaApp.page.getByLabel('面部美白数值')).toHaveValue('18', { timeout: 120_000 })
  await expect(lunaApp.page.getByLabel('皮肤整体美白数值')).toHaveValue('10')
  await expect(lunaApp.page.getByLabel('磨皮数值')).toHaveValue('28')
  await expect(lunaApp.page.getByRole('button', { name: '重试识别', exact: true })).toHaveCount(0)
  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { colorMasks?: Array<{ id: string; path: string }> } }>
    }
    return (persisted.assets[0]?.pipeline?.colorMasks ?? []).filter((layer) => layer.id.startsWith('beauty-'))
  }).toHaveLength(2)

  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: { colorMasks?: Array<{ id: string; path: string }> } }>
  }
  const face = persisted.assets[0]?.pipeline?.colorMasks?.find((layer) => layer.id === 'beauty-face-skin')
  expect(face).toBeDefined()
  const pgm = await readFile(face!.path)
  const dataStart = pgm.indexOf('\n255\n') + 5
  expect(pgm.subarray(dataStart).every((value) => value === 0)).toBe(true)
  expect(lunaApp.runtimeErrors).toEqual([])
})
