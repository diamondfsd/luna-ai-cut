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
    path.join(supportRoot, 'schp-atr-resnet101-512', 'model.onnx'),
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
    ['schp-atr-resnet101-512', models.humanParsing!],
    ['ultraface-rfb-320', models.faceDetector!],
  ].map(async ([id, source]) => {
    const directory = path.join(modelRoot, id)
    await mkdir(directory, { recursive: true })
    await copyFile(source, path.join(directory, 'model.onnx'))
  }))
}

async function openBeautyFixture(lunaApp: LunaElectronApp, fixtureSource: string, assetCount = 1): Promise<{
  project: { id: string }
  projectName: string
}> {
  const fixtureDir = path.join(lunaApp.temporaryRoot, 'fixtures')
  await mkdir(fixtureDir, { recursive: true })
  const assets = await Promise.all(Array.from({ length: assetCount }, async (_, index) => {
    const inputPath = path.join(fixtureDir, `beauty-input-${index + 1}${path.extname(fixtureSource) || '.jpg'}`)
    await copyFile(fixtureSource, inputPath)
    return { id: `beauty-input-${index + 1}`, name: `beauty-input-${index + 1}.jpg`, path: inputPath, kind: 'image' as const }
  }))
  const projectName = `美颜 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, projectAssets }) => (
    window.luna.workspace.createProject(name, projectAssets)
  ), { name: projectName, projectAssets: assets })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} ${assetCount} 个素材`, exact: true }).click()
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

  await expect(lunaApp.page.getByLabel('面部美白数值')).toHaveValue('0', { timeout: 120_000 })
  await expect(lunaApp.page.getByRole('button', { name: '重试识别', exact: true })).toHaveCount(0)
  const zoomIn = lunaApp.page.getByRole('button', { name: '放大预览', exact: true })
  for (let step = 0; step < 50; step += 1) await zoomIn.click()
  await expect(lunaApp.page.getByRole('button', { name: '当前缩放 500%，点击恢复适应窗口', exact: true })).toBeVisible()
  await zoomIn.click()
  await expect(lunaApp.page.getByRole('button', { name: '当前缩放 500%，点击恢复适应窗口', exact: true })).toBeVisible()
  await lunaApp.page.getByRole('button', { name: '当前缩放 500%，点击恢复适应窗口', exact: true }).click()
  await expect(lunaApp.page.getByLabel('皮肤美白数值')).toHaveValue('0')
  await expect(lunaApp.page.getByLabel('磨皮数值')).toHaveValue('18')
  await expect(lunaApp.page.getByLabel('质感数值')).toHaveValue('10')
  await expect(lunaApp.page.getByLabel('祛痘数值')).toHaveCount(0)
  await expect(lunaApp.page.getByLabel('淡化色斑数值')).toHaveCount(0)
  await expect(lunaApp.page.getByLabel('淡化皱纹数值')).toHaveCount(0)
  const setBeautyValues = async (face: number, skin: number, smoothing: number, texture = 0) => {
    await lunaApp.page.getByLabel('面部美白数值').fill(String(face))
    await lunaApp.page.getByLabel('面部美白数值').blur()
    await lunaApp.page.getByLabel('皮肤美白数值').fill(String(skin))
    await lunaApp.page.getByLabel('皮肤美白数值').blur()
    await lunaApp.page.getByLabel('磨皮数值').fill(String(smoothing))
    await lunaApp.page.getByLabel('磨皮数值').blur()
    await lunaApp.page.getByLabel('质感数值').fill(String(texture))
    await lunaApp.page.getByLabel('质感数值').blur()
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
  await setBeautyValues(100, 100, 100, 100)

  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { beautyMasks?: Array<{
        id: string
        path: string
        modelId: string
        color: { exposure: number; brightness: number; denoise: number; texture: number }
      }> } }>
    }
    const layers = persisted.assets[0]?.pipeline?.beautyMasks ?? []
    const face = layers.find((layer) => layer.id === 'beauty-face-skin')
    const body = layers.find((layer) => layer.id === 'beauty-body-skin')
    return {
      count: layers.filter((layer) => layer.id.startsWith('beauty-')).length,
      faceExposure: face?.color.exposure,
      faceBrightness: face?.color.brightness,
      faceDenoise: face?.color.denoise,
      faceTexture: face?.color.texture,
      bodyExposure: body?.color.exposure,
      bodyBrightness: body?.color.brightness,
      acneDenoise: layers.find((layer) => layer.id === 'beauty-acne')?.color.denoise,
      spotExposure: layers.find((layer) => layer.id === 'beauty-spots')?.color.exposure,
      wrinkleDenoise: layers.find((layer) => layer.id === 'beauty-wrinkles')?.color.denoise,
      faceModelId: face?.modelId,
      bodyModelId: body?.modelId,
      paths: [face?.path, body?.path].filter(Boolean),
    }
  }).toMatchObject({
    count: 5,
    faceExposure: 0.2,
    faceBrightness: 0,
    faceDenoise: 100,
    faceTexture: 100,
    bodyExposure: 0.08,
    bodyBrightness: 0,
    acneDenoise: 0,
    spotExposure: 0,
    wrinkleDenoise: 0,
    faceModelId: 'face-parsing-resnet18',
    bodyModelId: 'schp-atr-resnet101-512',
    paths: expect.any(Array),
  })

  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: {
      colorMasks?: Array<{ id: string; path: string }>
      beautyMasks?: Array<{ id: string; path: string }>
    } }>
  }
  expect(persisted.assets[0]?.pipeline?.colorMasks ?? []).toEqual([])
  const beautyMasks = (persisted.assets[0]?.pipeline?.beautyMasks ?? [])
    .filter((layer) => layer.id.startsWith('beauty-'))
  expect(beautyMasks).toHaveLength(5)
  for (const mask of beautyMasks) {
    expect((await stat(mask.path)).size).toBeGreaterThan(0)
    const pgm = await readFile(mask.path)
    const dataStart = pgm.indexOf('\n255\n') + 5
    expect(dataStart).toBeGreaterThan(4)
    expect(pgm.subarray(0, dataStart).toString('ascii')).toContain('1024 1024')
    if (mask.id === 'beauty-face-skin' || mask.id === 'beauty-body-skin') {
      expect(pgm.subarray(dataStart).some((value) => value >= 128), `${mask.id} 应包含有效皮肤像素`).toBe(true)
      expect(
        pgm.subarray(dataStart).some((value) => value > 0 && value < 255),
        `${mask.id} 应包含渐变边缘`,
      ).toBe(true)
    }
    if (screenshotDir) await copyFile(mask.path, path.join(screenshotDir, `${mask.id}.pgm`))
  }
  if (screenshotDir) {
    await lunaApp.page.locator('.preview-stage').screenshot({ path: path.join(screenshotDir, 'beauty-max.png') })
  }
  await expect(lunaApp.page.getByRole('button', { name: '测试蒙版', exact: true })).toHaveCount(0)
  await expect(lunaApp.page.getByTestId('beauty-mask-overlay')).toHaveCount(0)
  const retouchCanvas = lunaApp.page.getByLabel('局部修复画笔')
  const repairMode = lunaApp.page.getByRole('button', { name: '修复', exact: true })
  const eraseMode = lunaApp.page.getByRole('button', { name: '擦除', exact: true })
  await expect(repairMode).toHaveAttribute('aria-pressed', 'false')
  await expect(eraseMode).toHaveAttribute('aria-pressed', 'false')
  await expect(retouchCanvas).toHaveCount(0)
  if (screenshotDir) {
    await lunaApp.page.screenshot({ path: path.join(screenshotDir, 'beauty-local-retouch-idle.png') })
  }
  await repairMode.click()
  await expect(retouchCanvas).toBeVisible()
  await repairMode.click()
  await expect(repairMode).toHaveAttribute('aria-pressed', 'false')
  await expect(retouchCanvas).toHaveCount(0)
  await repairMode.click()
  await expect(retouchCanvas).toBeVisible()
  if (screenshotDir) {
    await lunaApp.page.screenshot({ path: path.join(screenshotDir, 'beauty-manual-retouch-layout.png') })
  }
  await retouchCanvas.click({ position: { x: 120, y: 90 } })
  await expect.poll(async () => {
    const projectData = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { beautyMasks?: Array<{ id: string; path: string }> } }>
    }
    return projectData.assets[0]?.pipeline?.beautyMasks?.find((layer) => layer.id === 'beauty-manual-retouch')?.path ?? ''
  }).not.toBe('')
  const manualProjectData = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: { beautyMasks?: Array<{ id: string; path: string }> } }>
  }
  const manualMaskPath = manualProjectData.assets[0]?.pipeline?.beautyMasks?.find((layer) => layer.id === 'beauty-manual-retouch')?.path
  expect(manualMaskPath).toBeTruthy()
  const manualMask = await readFile(manualMaskPath!)
  const manualDataStart = manualMask.indexOf('\n255\n') + 5
  expect(manualMask.subarray(manualDataStart).some((value) => value > 0)).toBe(true)
  await lunaApp.page.getByRole('button', { name: '调色与蒙版', exact: true }).click()
  await expect(retouchCanvas).toHaveCount(0)
  await expect(lunaApp.page.locator('.workspace-color-mask-layer')).toHaveCount(1)
  await expect(lunaApp.page.getByText('美颜 · 面部皮肤', { exact: true })).toHaveCount(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('复制美颜参数后在目标图片自动重新识别并应用', async ({ lunaApp }) => {
  test.skip(!models.face || !models.humanParsing || !models.faceDetector, '需要提供面部、人体和人脸检测 ONNX 模型')
  await installBeautyModels(lunaApp)
  const fixtureSource = process.env.LUNA_E2E_BEAUTY_INPUT_PATH
    ?? path.join(projectRoot, 'test-data', 'color-masking', 'd3-effect-set', 'images', 'person', 'person-04.jpg')
  const { project } = await openBeautyFixture(lunaApp, fixtureSource, 2)
  await lunaApp.page.getByRole('button', { name: '美颜', exact: true }).click()
  await expect(lunaApp.page.getByLabel('面部美白数值')).toHaveValue('0', { timeout: 120_000 })

  const values = [33, 22, 44, 45]
  const labels = ['面部美白数值', '皮肤美白数值', '磨皮数值', '质感数值']
  for (let index = 0; index < labels.length; index += 1) {
    const input = lunaApp.page.getByLabel(labels[index])
    await input.fill(String(values[index]))
    await input.blur()
  }
  await lunaApp.page.getByRole('button', { name: '调色与蒙版', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '复制效果', exact: true }).click()
  await lunaApp.page.locator('.workspace-thumb[data-media-index="1"]').click()

  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as { assets: Array<{ pipeline?: { beautyMasks?: unknown[] } }> }
    return persisted.assets[1]?.pipeline?.beautyMasks?.length ?? 0
  }).toBe(0)
  await lunaApp.page.getByRole('button', { name: '粘贴效果', exact: true }).click()
  await expect(lunaApp.page.getByText('已重新识别并粘贴到 1 个素材', { exact: true })).toBeVisible({ timeout: 120_000 })

  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { beautyMasks?: Array<{ id: string; path: string; enabled: boolean; color: { exposure: number; denoise: number; texture: number } }> } }>
    }
    const layers = persisted.assets[1]?.pipeline?.beautyMasks ?? []
    return {
      count: layers.filter((layer) => layer.id.startsWith('beauty-')).length,
      face: layers.find((layer) => layer.id === 'beauty-face-skin')?.color.exposure,
      body: layers.find((layer) => layer.id === 'beauty-body-skin')?.color.exposure,
      smoothing: layers.find((layer) => layer.id === 'beauty-face-skin')?.color.denoise,
      texture: layers.find((layer) => layer.id === 'beauty-face-skin')?.color.texture,
      acne: layers.find((layer) => layer.id === 'beauty-acne')?.color.denoise,
      spots: layers.find((layer) => layer.id === 'beauty-spots')?.color.exposure,
      wrinkles: layers.find((layer) => layer.id === 'beauty-wrinkles')?.color.denoise,
      paths: layers.filter((layer) => layer.id.startsWith('beauty-')).map((layer) => layer.path),
      enabled: layers.filter((layer) => layer.id.startsWith('beauty-')).every((layer) => layer.enabled),
    }
  }).toMatchObject({
    count: 5,
    face: 0.0572,
    body: 0.0176,
    smoothing: 44,
    texture: 45,
    acne: 0,
    spots: 0,
    wrinkles: 0,
    paths: expect.arrayContaining([expect.stringContaining('beauty-input-2')]),
    enabled: true,
  })
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
  await expect(lunaApp.page.getByLabel('面部美白数值')).toHaveValue('0', { timeout: 120_000 })
  await expect(lunaApp.page.getByLabel('皮肤美白数值')).toHaveValue('0')
  await expect(lunaApp.page.getByLabel('磨皮数值')).toHaveValue('18')
  await expect(lunaApp.page.getByLabel('质感数值')).toHaveValue('10')
  await expect(lunaApp.page.getByLabel('祛痘数值')).toHaveCount(0)
  await expect(lunaApp.page.getByLabel('淡化色斑数值')).toHaveCount(0)
  await expect(lunaApp.page.getByLabel('淡化皱纹数值')).toHaveCount(0)
  await expect(lunaApp.page.getByRole('button', { name: '重试识别', exact: true })).toHaveCount(0)
  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  await expect.poll(async () => {
    const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
      assets: Array<{ pipeline?: { beautyMasks?: Array<{ id: string; path: string }> } }>
    }
    return (persisted.assets[0]?.pipeline?.beautyMasks ?? []).filter((layer) => layer.id.startsWith('beauty-'))
  }).toHaveLength(5)

  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ pipeline?: { beautyMasks?: Array<{ id: string; path: string }> } }>
  }
  const face = persisted.assets[0]?.pipeline?.beautyMasks?.find((layer) => layer.id === 'beauty-face-skin')
  expect(face).toBeDefined()
  const pgm = await readFile(face!.path)
  const dataStart = pgm.indexOf('\n255\n') + 5
  expect(pgm.subarray(dataStart).every((value) => value === 0)).toBe(true)
  expect(lunaApp.runtimeErrors).toEqual([])
})
