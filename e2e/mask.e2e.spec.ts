import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '..')
const keepArtifacts = process.env.LUNA_E2E_KEEP_ARTIFACTS === '1'

interface FixturePaths {
  temporaryRoot: string
  userDataDir: string
  projectPath: string
  appLogPath: string
}

interface RunningApp {
  app: ElectronApplication
  page: Page
  runtimeErrors: string[]
}

async function waitForMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const hasLunaApi = await candidate.evaluate(() => 'luna' in window).catch(() => false)
      if (hasLunaApi) return candidate
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('等待 Luna 主窗口超时')
}

async function createFixture(): Promise<FixturePaths> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-mask-e2e-'))
  const userDataDir = path.join(temporaryRoot, 'user-data')
  const downloadDir = path.join(temporaryRoot, 'downloads')
  const fixtureDir = path.join(temporaryRoot, 'fixtures')
  const artifactDir = path.join(temporaryRoot, 'artifacts')
  const projectDir = path.join(downloadDir, 'workspace-projects', 'mask-e2e')
  const projectPath = path.join(projectDir, 'project.json')

  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(projectDir, { recursive: true }),
    mkdir(fixtureDir, { recursive: true }),
    mkdir(artifactDir, { recursive: true }),
  ])

  const sourceImage = path.join(projectRoot, 'public', 'luna-icon.png')
  const firstImage = path.join(fixtureDir, 'asset-a.png')
  const secondImage = path.join(fixtureDir, 'asset-b.png')
  await Promise.all([copyFile(sourceImage, firstImage), copyFile(sourceImage, secondImage)])

  const width = 1254
  const height = 1254
  const maskDir = path.join(projectDir, 'masks')
  const validMask = path.join(maskDir, 'valid.pgm')
  const damagedMask = path.join(maskDir, 'damaged.pgm')
  await mkdir(maskDir, { recursive: true })
  await writeFile(validMask, Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii'),
    Buffer.alloc(width * height, 255),
  ]))
  await writeFile(damagedMask, Buffer.from(`P5\n${width} ${height}\n255\n${'x'.repeat(32)}`, 'ascii'))

  const layer = (id: string, name: string, maskPath: string) => ({
    id,
    name,
    path: maskPath,
    width,
    height,
    opacity: 0.5,
    inverted: false,
    feather: 20,
    kind: 'brush',
    enabled: true,
    blendMode: 'normal',
  })
  const now = new Date().toISOString()
  await writeFile(projectPath, `${JSON.stringify({
    id: 'mask-e2e',
    name: '蒙版自动化测试',
    dir: projectDir,
    createdAt: now,
    updatedAt: now,
    assets: [
      { id: 'asset-a', name: '素材 A', path: firstImage, kind: 'image', pipeline: { colorMasks: [layer('valid-layer', '合法蒙版层', validMask)] } },
      { id: 'asset-b', name: '素材 B', path: secondImage, kind: 'image', pipeline: { colorMasks: [layer('damaged-layer', '待恢复蒙版层', damagedMask)] } },
    ],
  }, null, 2)}\n`, 'utf8')
  await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({
    downloadDir,
    localResourcesDir: path.join(downloadDir, 'localResources'),
    exportDir: path.join(downloadDir, 'export'),
    developerMode: false,
  }, null, 2)}\n`, 'utf8')

  return {
    temporaryRoot,
    userDataDir,
    projectPath,
    appLogPath: path.join(artifactDir, 'app.log'),
  }
}

async function launchApp(fixture: FixturePaths): Promise<RunningApp> {
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      LUNA_E2E_USER_DATA_DIR: fixture.userDataDir,
    },
  })
  const log = createWriteStream(fixture.appLogPath, { flags: 'a' })
  app.process().stdout?.pipe(log, { end: false })
  app.process().stderr?.pipe(log, { end: false })
  app.process().once('exit', () => log.end())

  const page = await waitForMainWindow(app)
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  await page.waitForLoadState('domcontentloaded')
  return { app, page, runtimeErrors }
}

async function openFixtureProject(page: Page): Promise<void> {
  await page.evaluate(() => { window.location.hash = '/workspace' })
  await expect(page.getByText('工作台项目', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '蒙版自动化测试', exact: true }).click()
  await expect(page.getByRole('button', { name: '返回工作台', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '调色与蒙版', exact: true }).click()
  await expect(page.getByLabel('蒙版图层')).toBeVisible()
}

async function openValidMaskEditor(page: Page): Promise<void> {
  await page.getByRole('button', { name: '编辑蒙版', exact: true }).click()
  await expect(page.getByText('编辑蒙版 · 合法蒙版层', { exact: true })).toBeVisible()
  await expect(page.getByLabel('羽化滑块')).toHaveAttribute('aria-valuenow', '20')
}

async function selectFirstMaskLayer(page: Page): Promise<void> {
  await page.locator('.workspace-color-mask-layer:not(.workspace-color-mask-global-layer) .workspace-color-mask-layer-select').first().click()
}

async function expectDamagedMaskFallback(page: Page): Promise<void> {
  await expect(page.getByText('待恢复蒙版层', { exact: true })).toBeVisible()
  await selectFirstMaskLayer(page)
  await expect(page.getByText('文件不可用，可重新编辑', { exact: true })).toBeVisible()
  await expect(page.getByLabel('蒙版文件不可用，无法切换显示')).toBeDisabled()
}

test('蒙版编辑可自动保存，并在重启后恢复损坏降级状态', async () => {
  const testInfo = test.info()
  const fixture = await createFixture()
  let running: RunningApp | undefined
  let succeeded = false

  try {
    running = await launchApp(fixture)
    await openFixtureProject(running.page)
    await openValidMaskEditor(running.page)

    await running.page.getByLabel('羽化数值').fill('40')
    await running.page.getByLabel('羽化数值').press('Enter')
    await expect(running.page.getByLabel('羽化滑块')).toHaveAttribute('aria-valuenow', '40')
    await expect(running.page.getByLabel('撤销')).toBeEnabled()

    await running.page.getByLabel('撤销').click()
    await expect(running.page.getByLabel('羽化滑块')).toHaveAttribute('aria-valuenow', '20')
    await running.page.getByLabel('重做').click()
    await expect(running.page.getByLabel('羽化滑块')).toHaveAttribute('aria-valuenow', '40')

    await running.page.locator('.workspace-thumb').nth(1).click()
    await expectDamagedMaskFallback(running.page)
    await expect(running.page.getByLabel('撤销')).toBeDisabled()

    await expect.poll(async () => {
      const project = JSON.parse(await readFile(fixture.projectPath, 'utf8'))
      return {
        feather: project.assets[0].pipeline.colorMasks[0].feather,
        enabled: project.assets[1].pipeline.colorMasks[0].enabled,
        loadError: project.assets[1].pipeline.colorMasks[0].loadError,
      }
    }).toEqual({ feather: 40, enabled: false, loadError: 'missing-or-damaged' })
    expect(running.runtimeErrors).toEqual([])

    await running.app.close()
    running = await launchApp(fixture)
    await openFixtureProject(running.page)
    await running.page.getByRole('button', { name: '编辑蒙版', exact: true }).click()
    await expect(running.page.getByText('编辑蒙版 · 合法蒙版层', { exact: true })).toBeVisible()
    await expect(running.page.getByLabel('羽化滑块')).toHaveAttribute('aria-valuenow', '40')
    await running.page.locator('.workspace-thumb').nth(1).click()
    await expectDamagedMaskFallback(running.page)
    expect(running.runtimeErrors).toEqual([])
    succeeded = true
  } catch (error) {
    if (running) {
      await testInfo.attach('electron-failure.png', {
        body: await running.page.screenshot().catch(() => Buffer.from('')),
        contentType: 'image/png',
      })
    }
    throw error
  } finally {
    await running?.app.close().catch(() => undefined)
    if (succeeded && !keepArtifacts) {
      await rm(fixture.temporaryRoot, { recursive: true, force: true })
    } else {
      console.log(`Electron E2E 临时目录: ${fixture.temporaryRoot}`)
    }
  }
})
