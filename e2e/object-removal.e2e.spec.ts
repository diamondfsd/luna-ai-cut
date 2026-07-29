import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')
const modelCandidates = [
  process.env.LUNA_E2E_LAMA_MODEL_PATH,
  path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'luna-ai-cut', 'models', 'big-lama-fp32', 'lama_fp32.onnx'),
  path.join(process.env.HOME ?? '', 'Library', 'Caches', 'LunaAICut', 'models', 'big-lama-fp32', 'lama_fp32.onnx'),
].filter((candidate): candidate is string => Boolean(candidate))
const modelPath = modelCandidates.find(existsSync)
const generativeModelPath = process.env.LUNA_E2E_SD_MODEL_PATH
const generativeRuntimePath = process.env.LUNA_E2E_SD_CLI_PATH
const generativeReady = Boolean(generativeModelPath && generativeRuntimePath && existsSync(generativeModelPath) && existsSync(generativeRuntimePath))

test.use({
  lunaElectronOptions: {
    launchEnv: {
      ...(modelPath ? { LUNA_LAMA_MODEL_PATH: modelPath } : {}),
      ...(generativeReady ? { LUNA_SD_INPAINT_MODEL_PATH: generativeModelPath, LUNA_SD_CLI_PATH: generativeRuntimePath } : {}),
    },
  },
})

test('Apple GPU 生成式重建按需启用并持久化生成参数', async ({ lunaApp }) => {
  test.skip(process.platform !== 'darwin' || process.arch !== 'arm64' || !generativeReady, '需要 Apple Silicon、Metal sd-cli 和已校验的 SD inpainting 模型')

  const fixtureDir = path.join(lunaApp.temporaryRoot, 'generative-fixtures')
  const inputPath = path.join(fixtureDir, 'generative-input.png')
  await mkdir(fixtureDir, { recursive: true })
  await copyFile(path.join(projectRoot, 'public', 'luna-icon.png'), inputPath)
  const projectName = `生成式重建 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, filePath }) => window.luna.workspace.createProject(name, [{
    id: 'generative-input', name: 'generative-input.png', path: filePath, kind: 'image',
  }]), { name: projectName, filePath: inputPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 1 个素材`, exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '对象消除', exact: true }).click()

  const generativeSwitch = lunaApp.page.getByLabel('使用显卡生成式重建')
  await expect(generativeSwitch).toBeEnabled({ timeout: 30_000 })
  await expect(lunaApp.page.getByText(/Apple .*模型已就绪/)).toBeVisible()
  await generativeSwitch.click()
  await expect(generativeSwitch).toBeChecked()

  const overlay = lunaApp.page.locator('.workspace-mask-overlay-shell')
  await lunaApp.page.getByRole('button', { name: '框选', exact: true }).click()
  const box = await overlay.boundingBox()
  if (!box) throw new Error('生成式重建遮罩没有可交互区域')
  await lunaApp.page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35)
  await lunaApp.page.mouse.down()
  await lunaApp.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 })
  await lunaApp.page.mouse.up()
  await lunaApp.page.getByRole('button', { name: '开始重建', exact: true }).click()
  await expect(lunaApp.page.getByRole('button', { name: '按住查看原图', exact: true })).toBeVisible({ timeout: 180_000 })

  const projectFile = path.join(lunaApp.temporaryRoot, 'downloads', 'workspace-projects', project.id, 'project.json')
  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{ removal?: { operations: Array<{ mode?: string; model: Record<string, unknown> }> } }>
  }
  const operation = persisted.assets[0]?.removal?.operations[0]
  expect(operation?.mode).toBe('generative')
  expect(operation?.model.id).toBe('stable-diffusion-v1-5-inpainting-q4-0')
  expect(operation?.model.backend).toBe('metal')
  expect(operation?.model.seed).toBe(42)
  expect(operation?.model.steps).toBe(20)
  expect(lunaApp.runtimeErrors).toEqual([])
})

test('对象消除批量处理分离选区并持久化结果', async ({ lunaApp }) => {
  test.skip(!modelPath, '需要通过 LUNA_E2E_LAMA_MODEL_PATH 提供已校验的 Big-LaMa FP32 模型')

  const fixtureDir = path.join(lunaApp.temporaryRoot, 'fixtures')
  const inputPath = path.join(fixtureDir, 'object-removal-input.png')
  await mkdir(fixtureDir, { recursive: true })
  await copyFile(path.join(projectRoot, 'public', 'luna-icon.png'), inputPath)

  const projectName = `对象消除 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, filePath }) => (
    window.luna.workspace.createProject(name, [{
      id: 'object-removal-input',
      name: 'object-removal-input.png',
      path: filePath,
      kind: 'image',
    }])
  ), { name: projectName, filePath: inputPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')

  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 1 个素材`, exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '对象消除', exact: true }).click()

  const overlay = lunaApp.page.locator('.workspace-mask-overlay-shell')
  await expect(overlay).toBeVisible()
  await expect(lunaApp.page.getByRole('button', { name: '划选', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(overlay.locator('.workspace-instance-stroke-overlay')).toBeVisible()
  await expect(lunaApp.page.getByLabel('蒙版扩展数值')).toHaveValue('1')
  const rectangleButton = lunaApp.page.getByRole('button', { name: '框选', exact: true })
  await rectangleButton.click()
  await expect(rectangleButton).toHaveAttribute('aria-pressed', 'true')
  await expect(overlay.locator('.workspace-mask-overlay')).toHaveCSS('cursor', 'crosshair')
  const box = await overlay.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error('对象消除遮罩没有可交互区域')

  for (const [left, right] of [[0.18, 0.3], [0.7, 0.82]]) {
    await lunaApp.page.mouse.move(box.x + box.width * left, box.y + box.height * 0.42)
    await lunaApp.page.mouse.down()
    await lunaApp.page.mouse.move(box.x + box.width * right, box.y + box.height * 0.58, { steps: 8 })
    await lunaApp.page.mouse.up()
  }

  const startButton = lunaApp.page.getByRole('button', { name: '开始消除', exact: true })
  await expect(startButton).toBeEnabled()
  await startButton.click()

  await expect(lunaApp.page.getByRole('button', { name: '取消处理', exact: true })).toBeVisible()
  await expect(overlay).toHaveAttribute('data-reconstructing', 'true')
  await expect(lunaApp.page.getByRole('button', { name: '按住查看原图', exact: true })).toBeVisible({ timeout: 120_000 })
  await expect(lunaApp.page.getByRole('button', { name: '删除消除结果', exact: true })).toBeVisible()
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 30_000 })

  const previewCanvas = await lunaApp.page.locator('.preview-canvas-wrapper canvas').elementHandle()
  expect(previewCanvas).not.toBeNull()
  const compareButton = lunaApp.page.getByRole('button', { name: '按住查看原图', exact: true })
  await compareButton.dispatchEvent('pointerdown')
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 1_000 })
  expect(await previewCanvas?.evaluate((canvas) => canvas.isConnected)).toBe(true)
  await compareButton.dispatchEvent('pointerup')
  await expect(lunaApp.page.locator('.preview-loading-overlay')).toBeHidden({ timeout: 1_000 })
  expect(await previewCanvas?.evaluate((canvas) => canvas.isConnected)).toBe(true)

  const projectFile = path.join(
    lunaApp.temporaryRoot,
    'downloads',
    'workspace-projects',
    project.id,
    'project.json',
  )
  const persisted = JSON.parse(await readFile(projectFile, 'utf8')) as {
    assets: Array<{
      pipeline?: { colorMasks?: unknown[] }
      removal?: {
        schemaVersion: number
        operations: Array<{ enabled: boolean; resultPath: string; maskPath: string }>
      }
    }>
  }
  const operation = persisted.assets[0]?.removal?.operations[0]
  expect(persisted.assets[0]?.removal?.schemaVersion).toBe(1)
  expect(persisted.assets[0]?.pipeline?.colorMasks ?? []).toEqual([])
  expect(operation?.enabled).toBe(true)
  expect(operation?.resultPath.startsWith(lunaApp.temporaryRoot)).toBe(true)
  expect(operation?.maskPath.startsWith(lunaApp.temporaryRoot)).toBe(true)
  await expect.poll(async () => Boolean(operation && (await stat(operation.resultPath)).isFile())).toBe(true)
  await expect.poll(async () => Boolean(operation && (await stat(operation.maskPath)).isFile())).toBe(true)
  expect(lunaApp.runtimeErrors).toEqual([])
})
