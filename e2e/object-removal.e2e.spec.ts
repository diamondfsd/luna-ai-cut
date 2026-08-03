import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')
const modelCandidates = [
  process.env.LUNA_E2E_LAMA_MODEL_PATH,
  path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'luna-ai-cut', 'models', 'big-lama-fp32', 'lama_fp32.onnx'),
  path.join(process.env.HOME ?? '', 'Library', 'Caches', 'LunaAICut', 'models', 'big-lama-fp32', 'lama_fp32.onnx'),
].filter((candidate): candidate is string => Boolean(candidate))
const modelPath = modelCandidates.find(existsSync)

test.use({
  lunaElectronOptions: {
    launchEnv: modelPath ? { LUNA_LAMA_MODEL_PATH: modelPath } : {},
  },
})

test('对象消除批量处理分离选区并持久化结果', async ({ lunaApp }) => {
  test.skip(!modelPath, '需要通过 LUNA_E2E_LAMA_MODEL_PATH 提供已校验的 Big-LaMa FP32 模型')

  const fixtureDir = path.join(lunaApp.temporaryRoot, 'fixtures')
  const inputPath = path.join(fixtureDir, 'object-removal-input.png')
  const secondInputPath = path.join(fixtureDir, 'object-removal-second.png')
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    copyFile(path.join(projectRoot, 'public', 'luna-icon.png'), inputPath),
    copyFile(path.join(projectRoot, 'public', 'luna-icon.png'), secondInputPath),
  ])

  const projectName = `对象消除 E2E ${Date.now()}`
  const project = await lunaApp.page.evaluate(async ({ name, filePath, secondFilePath }) => (
    window.luna.workspace.createProject(name, [
      { id: 'object-removal-input', name: 'object-removal-input.png', path: filePath, kind: 'image' },
      { id: 'object-removal-second', name: 'object-removal-second.png', path: secondFilePath, kind: 'image' },
    ])
  ), { name: projectName, filePath: inputPath, secondFilePath: secondInputPath })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')

  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()
  await lunaApp.page.getByRole('button', { name: `${projectName} 2 个素材`, exact: true }).click()
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
  await expect(lunaApp.page.getByRole('button', { name: '删除全部结果', exact: true })).toBeVisible()
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
        operations: Array<{
          enabled: boolean
          resultPath: string
          resultBytes: number
          resultSha256: string
          maskPath: string
          maskBytes: number
          maskSha256: string
        }>
      }
    }>
  }
  const operation = persisted.assets[0]?.removal?.operations[0]
  expect(persisted.assets[0]?.removal?.schemaVersion).toBe(1)
  expect(persisted.assets[0]?.pipeline?.colorMasks ?? []).toEqual([])
  expect(operation?.enabled).toBe(true)
  expect(operation?.resultPath.startsWith(lunaApp.temporaryRoot)).toBe(true)
  expect(operation?.maskPath.startsWith(lunaApp.temporaryRoot)).toBe(true)
  expect(operation?.resultBytes).toBeGreaterThan(0)
  expect(operation?.resultSha256).toMatch(/^[a-f0-9]{64}$/)
  expect(operation?.maskBytes).toBeGreaterThan(0)
  expect(operation?.maskSha256).toMatch(/^[a-f0-9]{64}$/)
  await expect.poll(async () => Boolean(operation && (await stat(operation.resultPath)).isFile())).toBe(true)
  await expect.poll(async () => Boolean(operation && (await stat(operation.maskPath)).isFile())).toBe(true)

  const stepSwitch = lunaApp.page.getByLabel('启用消除步骤 1')
  await stepSwitch.click()
  await expect(stepSwitch).not.toBeChecked()
  await stepSwitch.click()
  await expect(stepSwitch).toBeChecked()

  await rectangleButton.click()
  const currentBox = await overlay.boundingBox()
  if (!currentBox) throw new Error('第二次对象消除遮罩没有可交互区域')
  await lunaApp.page.mouse.move(currentBox.x + currentBox.width * 0.35, currentBox.y + currentBox.height * 0.35)
  await lunaApp.page.mouse.down()
  await lunaApp.page.mouse.move(currentBox.x + currentBox.width * 0.55, currentBox.y + currentBox.height * 0.55, { steps: 8 })
  await lunaApp.page.mouse.up()
  await startButton.click()
  await expect(lunaApp.page.getByRole('button', { name: '取消处理', exact: true })).toBeVisible()
  await lunaApp.page.locator('.workspace-thumb[data-media-index="1"]').click()
  await expect(lunaApp.page.getByRole('button', { name: '取消处理', exact: true })).toBeHidden()
  await expect.poll(async () => {
    const current = JSON.parse(await readFile(projectFile, 'utf8')) as { assets: Array<{ removal?: { operations: unknown[] } }> }
    return [current.assets[0]?.removal?.operations.length ?? 0, current.assets[1]?.removal?.operations.length ?? 0]
  }).toEqual([1, 0])

  await lunaApp.page.locator('.workspace-thumb[data-media-index="0"]').click()
  await lunaApp.page.getByLabel('删除消除步骤 1').click()
  await expect.poll(async () => (await readdir(path.dirname(operation!.resultPath))).filter((name) => name.endsWith('.png') || name.endsWith('.mask'))).toEqual([])
  await lunaApp.page.getByRole('button', { name: '调色与蒙版', exact: true }).click()
  await expect(lunaApp.page.getByRole('heading', { name: '调色与蒙版', exact: true })).toBeVisible()
  expect(lunaApp.runtimeErrors).toEqual([])
})
