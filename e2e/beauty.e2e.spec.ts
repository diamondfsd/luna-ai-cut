import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

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

test('图片美颜识别人脸与身体皮肤并持久化参数', async ({ lunaApp }) => {
  test.skip(!models.face || !models.humanParsing || !models.faceDetector, '需要提供面部、人体和人脸检测 ONNX 模型')

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

  const fixtureDir = path.join(lunaApp.temporaryRoot, 'fixtures')
  const inputPath = path.join(fixtureDir, 'beauty-input.jpg')
  await mkdir(fixtureDir, { recursive: true })
  await copyFile(path.join(projectRoot, 'test-data', 'color-masking', 'd3-effect-set', 'images', 'person', 'person-03.jpg'), inputPath)

  const projectName = `美颜 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, filePath }) => (
    window.luna.workspace.createProject(name, [{ id: 'beauty-input', name: 'beauty-input.jpg', path: filePath, kind: 'image' }])
  ), { name: projectName, filePath: inputPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 1 个素材`, exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '美颜', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '开始美颜', exact: true }).click()

  await expect(lunaApp.page.getByLabel('面部美白数值')).toHaveValue('18', { timeout: 120_000 })
  await expect(lunaApp.page.getByLabel('皮肤整体美白数值')).toHaveValue('10')
  await expect(lunaApp.page.getByLabel('磨皮数值')).toHaveValue('28')
  await lunaApp.page.getByLabel('面部美白数值').fill('35')
  await lunaApp.page.getByLabel('面部美白数值').blur()
  await lunaApp.page.getByLabel('皮肤整体美白数值').fill('24')
  await lunaApp.page.getByLabel('皮肤整体美白数值').blur()
  await lunaApp.page.getByLabel('磨皮数值').fill('42')
  await lunaApp.page.getByLabel('磨皮数值').blur()

  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { colorMasks?: Array<{
        id: string
        path: string
        modelId: string
        color: { brightness: number; denoise: number }
      }> } }>
    }
    const layers = persisted.assets[0]?.pipeline?.colorMasks ?? []
    const face = layers.find((layer) => layer.id === 'beauty-face-skin')
    const body = layers.find((layer) => layer.id === 'beauty-body-skin')
    return {
      count: layers.filter((layer) => layer.id.startsWith('beauty-')).length,
      faceBrightness: face?.color.brightness,
      faceDenoise: face?.color.denoise,
      bodyBrightness: body?.color.brightness,
      faceModelId: face?.modelId,
      bodyModelId: body?.modelId,
      paths: [face?.path, body?.path].filter(Boolean),
    }
  }).toMatchObject({
    count: 2,
    faceBrightness: 12.02,
    faceDenoise: 42,
    bodyBrightness: 4.32,
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
    expect(pgm.subarray(dataStart).some((value) => value >= 128), `${mask.id} 应包含有效皮肤像素`).toBe(true)
  }
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })
  expect(lunaApp.runtimeErrors).toEqual([])
})
