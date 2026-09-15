import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

test.use({
  lunaElectronOptions: {
    launchEnv: {
      LUNA_NAS_DEBUG_ROOT: path.resolve(import.meta.dirname, '..', 'build'),
    },
  },
})

test('调试页可以切换本地 NAS 调试配置', async ({ lunaApp }) => {
  const page = lunaApp.page

  await page.getByRole('link', { name: '设置', exact: true }).click()
  const secretTrigger = page.locator('.settings-secret-trigger')
  for (let index = 0; index < 5; index += 1) await secretTrigger.click()

  await page.evaluate(() => { window.location.hash = '#/ble-debug' })
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/ble-debug')
  await expect(page.locator('.nas-debug-panel')).toBeVisible()

  const toggle = page.getByRole('switch', { name: 'NAS 调试模式' })
  await expect(toggle).not.toBeChecked()
  const previousNas = await page.evaluate(() => window.luna.saveSettings({
    nasSync: {
      enabled: false,
      autoSync: false,
      server: 'saved-nas.example',
      port: 445,
      share: 'saved-share',
      remotePath: '/',
      username: 'saved-user',
      password: 'saved-password',
    },
  })).then((settings) => settings.nasSync)
  await toggle.click()
  await expect.poll(async () => page.evaluate(() => window.luna.getSettings())).toMatchObject({
    nasSync: {
      enabled: true,
      autoSync: true,
      server: '127.0.0.1',
      port: 1445,
      share: 'lunaaicut',
      remotePath: '/',
      username: 'demo',
      password: 'demo',
    },
  })
  const paths = page.locator('.nas-debug-paths')
  await expect(paths).toContainText(path.join(lunaApp.temporaryRoot, 'downloads', 'localResources'))
  await expect(paths).toContainText('smb://127.0.0.1:1445/lunaaicut')
  await expect(paths).toContainText(path.resolve(import.meta.dirname, '..', 'build'))
  await expect(paths.getByRole('button', { name: '打开', exact: true })).toBeEnabled()
  const storedWhileDebugging = JSON.parse(await readFile(path.join(lunaApp.temporaryRoot, 'user-data', 'settings.json'), 'utf8')) as Record<string, unknown>
  expect(storedWhileDebugging.nasSync).toEqual(previousNas)
  expect(storedWhileDebugging).not.toHaveProperty('nasSyncDebugMode')
  expect(storedWhileDebugging).not.toHaveProperty('nasSyncDebugPrevious')

  await toggle.click()
  await expect.poll(async () => page.evaluate(() => window.luna.getSettings())).toMatchObject({ nasSync: previousNas })
  expect(lunaApp.runtimeErrors).toEqual([])
})
