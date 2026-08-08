import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const keepArtifacts = process.env.LUNA_E2E_KEEP_ARTIFACTS === '1'

export interface LunaElectronApp {
  app: ElectronApplication
  page: Page
  runtimeErrors: string[]
  temporaryRoot: string
  userDataDir: string
}

export interface LunaElectronOptions {
  launchEnv: Record<string, string>
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

export const test = base.extend<{ lunaApp: LunaElectronApp; lunaElectronOptions: LunaElectronOptions }>({
  lunaElectronOptions: [{ launchEnv: {} }, { option: true }],
  lunaApp: async ({ playwright: _playwright, lunaElectronOptions }, use, testInfo) => {
    void _playwright
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-playwright-e2e-'))
    const existingUserDataDir = process.env.LUNA_E2E_EXISTING_USER_DATA_DIR
    const useExistingUserDataDir = Boolean(existingUserDataDir)
    const userDataDir = existingUserDataDir
      ? path.resolve(existingUserDataDir)
      : path.join(temporaryRoot, 'user-data')
    const downloadDir = path.join(temporaryRoot, 'downloads')
    const artifactDir = path.join(temporaryRoot, 'artifacts')
    await Promise.all([
      useExistingUserDataDir ? access(userDataDir) : mkdir(userDataDir, { recursive: true }),
      mkdir(downloadDir, { recursive: true }),
      mkdir(artifactDir, { recursive: true }),
    ])
    if (!useExistingUserDataDir) {
      await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({
        downloadDir,
        localResourcesDir: path.join(downloadDir, 'localResources'),
        exportDir: path.join(downloadDir, 'export'),
        developerMode: false,
      }, null, 2)}\n`, 'utf8')
    }

    let app: ElectronApplication | undefined
    try {
      app = await electron.launch({
        args: ['.'],
        cwd: projectRoot,
        env: {
          ...process.env,
          LUNA_E2E_FREECUT_STORAGE: 'disk',
          ...lunaElectronOptions.launchEnv,
          LUNA_E2E_USER_DATA_DIR: userDataDir,
        },
      })
      const log = createWriteStream(path.join(artifactDir, 'app.log'), { flags: 'a' })
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
      await use({ app, page, runtimeErrors, temporaryRoot, userDataDir })
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      const page = app?.windows().find((candidate) => !candidate.isClosed())
      if (failed && page) {
        const screenshot = await page.screenshot().catch(() => null)
        if (screenshot) {
          await testInfo.attach('electron-failure.png', { body: screenshot, contentType: 'image/png' })
        }
      }
      await app?.close().catch(() => undefined)
      if (!failed && !keepArtifacts) {
        await rm(temporaryRoot, { recursive: true, force: true })
      } else {
        console.log(`Electron E2E 临时目录: ${temporaryRoot}`)
      }
    }
  },
})

export { expect } from '@playwright/test'
