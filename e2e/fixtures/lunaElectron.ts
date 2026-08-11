import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { createWriteStream } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  seedProject?: {
    sourceUserDataDir: string
    projectId: string
  }
}

interface WorkspaceIndex {
  version: string
  updatedAt: number
  projects: Array<{ id: string; name: string; updatedAt: number }>
}

interface MediaLinks {
  version: string
  mediaIds: Array<{ id: string; addedAt: number }>
}

async function seedProject(
  userDataDir: string,
  seed: NonNullable<LunaElectronOptions['seedProject']>,
): Promise<void> {
  const sourceWorkspace = path.join(seed.sourceUserDataDir, 'freecut-workspace')
  const targetWorkspace = path.join(userDataDir, 'freecut-workspace')
  const sourceProject = path.join(sourceWorkspace, 'projects', seed.projectId)
  const targetProject = path.join(targetWorkspace, 'projects', seed.projectId)
  const sourceIndex = JSON.parse(
    await readFile(path.join(sourceWorkspace, 'index.json'), 'utf8'),
  ) as WorkspaceIndex
  const projectEntry = sourceIndex.projects.find((project) => project.id === seed.projectId)
  if (!projectEntry) throw new Error(`Seed project ${seed.projectId} is missing from workspace index`)

  await mkdir(targetProject, { recursive: true })
  await Promise.all([
    cp(path.join(sourceProject, 'project.json'), path.join(targetProject, 'project.json')),
    cp(path.join(sourceProject, 'media-links.json'), path.join(targetProject, 'media-links.json')),
    cp(path.join(sourceWorkspace, '.freecut-workspace.json'), path.join(targetWorkspace, '.freecut-workspace.json')),
  ])
  await writeFile(path.join(targetWorkspace, 'index.json'), `${JSON.stringify({
    ...sourceIndex,
    updatedAt: Date.now(),
    projects: [{ ...projectEntry, updatedAt: Date.now() }],
  }, null, 2)}\n`, 'utf8')

  const mediaLinks = JSON.parse(
    await readFile(path.join(sourceProject, 'media-links.json'), 'utf8'),
  ) as MediaLinks
  await Promise.all(mediaLinks.mediaIds.map(async ({ id }) => {
    const targetMedia = path.join(targetWorkspace, 'media', id)
    await mkdir(path.dirname(targetMedia), { recursive: true })
    await cp(path.join(sourceWorkspace, 'media', id), targetMedia, {
      recursive: true,
      force: true,
    })
  }))
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
    const baseDir = path.join(temporaryRoot, 'downloads')
    const artifactDir = path.join(temporaryRoot, 'artifacts')
    await Promise.all([
      useExistingUserDataDir ? access(userDataDir) : mkdir(userDataDir, { recursive: true }),
      mkdir(baseDir, { recursive: true }),
      mkdir(artifactDir, { recursive: true }),
    ])
    if (!useExistingUserDataDir) {
      await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({
        baseDir,
        localResourcesDir: path.join(baseDir, 'localResources'),
        exportDir: path.join(baseDir, 'export'),
        developerMode: false,
      }, null, 2)}\n`, 'utf8')
    }
    if (lunaElectronOptions.seedProject) {
      if (useExistingUserDataDir) {
        throw new Error('seedProject requires the fixture-managed isolated user data directory')
      }
      await seedProject(userDataDir, lunaElectronOptions.seedProject)
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
