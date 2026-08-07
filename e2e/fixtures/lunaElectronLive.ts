import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(import.meta.dirname, '../..')

export interface LunaLiveElectronApp {
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

/**
 * Launches Electron with its regular userData directory. Live tests can use
 * configured providers and existing projects, so they must be opt-in specs.
 */
export const test = base.extend<{ lunaLiveApp: LunaLiveElectronApp }>({
  lunaLiveApp: async ({ playwright: _playwright }, use, testInfo) => {
    void _playwright
    const liveEnv = { ...process.env }
    delete liveEnv.LUNA_E2E_USER_DATA_DIR
    const artifactDir = testInfo.outputPath('live-electron')
    await mkdir(artifactDir, { recursive: true })

    let app: ElectronApplication | undefined
    try {
      app = await electron.launch({
        args: ['.'],
        cwd: projectRoot,
        // Do not inherit a caller's isolated profile by accident.
        env: liveEnv,
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
      await use({ app, page, runtimeErrors })
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      const page = app?.windows().find((candidate) => !candidate.isClosed())
      if (failed && page) {
        const screenshot = await page.screenshot().catch(() => null)
        if (screenshot) {
          await testInfo.attach('live-electron-failure.png', { body: screenshot, contentType: 'image/png' })
        }
      }
      await app?.close().catch(() => undefined)
    }
  },
})

export { expect } from '@playwright/test'
