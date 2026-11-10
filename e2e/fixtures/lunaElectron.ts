import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  restart(launchEnv?: Record<string, string>): Promise<void>
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
    const userDataDir = path.join(temporaryRoot, 'user-data')
    const baseDir = path.join(temporaryRoot, 'downloads')
    const artifactDir = path.join(temporaryRoot, 'artifacts')
    await Promise.all([
      mkdir(userDataDir, { recursive: true }),
      mkdir(baseDir, { recursive: true }),
      mkdir(artifactDir, { recursive: true }),
    ])
    await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({
      baseDir,
      localResourcesDir: path.join(baseDir, 'localResources'),
      exportDir: path.join(baseDir, 'export'),
      developerMode: false,
    }, null, 2)}\n`, 'utf8')

    let app: ElectronApplication | undefined
    let page: Page | undefined
    const runtimeErrors: string[] = []
    const log = createWriteStream(path.join(artifactDir, 'app.log'), { flags: 'a' })

    const launchApp = async (restartEnv: Record<string, string> = {}): Promise<void> => {
      app = await electron.launch({
        args: ['.'],
        cwd: projectRoot,
        env: {
          ...process.env,
          ...lunaElectronOptions.launchEnv,
          ...restartEnv,
          LUNA_E2E_USER_DATA_DIR: userDataDir,
        },
      })
      app.process().stdout?.pipe(log, { end: false })
      app.process().stderr?.pipe(log, { end: false })
      page = await waitForMainWindow(app)
      page.on('pageerror', (error) => runtimeErrors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text())
      })
      await page.waitForLoadState('domcontentloaded')
    }

    try {
      await launchApp()
      await use({
        get app() {
          if (!app) throw new Error('Electron app is not running')
          return app
        },
        get page() {
          if (!page) throw new Error('Electron page is not available')
          return page
        },
        runtimeErrors,
        temporaryRoot,
        restart: async (restartEnv) => {
          await app?.close()
          app = undefined
          page = undefined
          await launchApp(restartEnv)
        },
      })
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      const activePage = app?.windows().find((candidate) => !candidate.isClosed())
      if (failed && activePage) {
        const screenshot = await activePage.screenshot().catch(() => null)
        if (screenshot) {
          await testInfo.attach('electron-failure.png', { body: screenshot, contentType: 'image/png' })
        }
      }
      await app?.close().catch(() => undefined)
      log.end()
      if (!failed && !keepArtifacts) {
        await rm(temporaryRoot, { recursive: true, force: true })
      } else {
        console.log(`Electron E2E 临时目录: ${temporaryRoot}`)
      }
    }
  },
})

export { expect } from '@playwright/test'
