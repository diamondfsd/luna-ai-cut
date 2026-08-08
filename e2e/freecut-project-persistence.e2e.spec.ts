import { _electron as electron } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { expect, test } from './fixtures/lunaElectron'

async function waitForLunaWindow(app: import('@playwright/test').ElectronApplication) {
  await expect.poll(async () => {
    const page = app.windows()[0]
    return page ? page.evaluate(() => 'luna' in window).catch(() => false) : false
  }).toBe(true)
  return app.windows()[0]!
}

test('FreeCut 项目在 Electron 重启后仍可打开', async ({ lunaApp }) => {
  const { app, page, runtimeErrors, temporaryRoot } = lunaApp

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.location.origin)).toBe('luna://app')
  await page.evaluate(() => localStorage.setItem('freecut-persistence-e2e', 'stored'))
  await expect.poll(async () => {
    const projectRoot = path.join(temporaryRoot, 'user-data', 'freecut-workspace', 'projects')
    const entries = await readdir(projectRoot, { withFileTypes: true }).catch(() => [])
    return entries.filter((entry) => entry.isDirectory()).length
  }).toBe(1)

  await app.close()

  const userDataDir = path.join(temporaryRoot, 'user-data')
  const relaunched = await electron.launch({
    args: ['.'],
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, LUNA_E2E_USER_DATA_DIR: userDataDir, LUNA_E2E_FREECUT_STORAGE: 'disk' },
  })
  try {
    const relaunchedPage = await waitForLunaWindow(relaunched)
    const relaunchErrors: string[] = []
    relaunchedPage.on('pageerror', (error) => relaunchErrors.push(error.message))
    relaunchedPage.on('console', (message) => {
      if (message.type() === 'error') relaunchErrors.push(message.text())
    })
    await relaunchedPage.getByRole('link', { name: '剪辑', exact: true }).click()
    await expect.poll(() => relaunchedPage.evaluate(() => localStorage.getItem('freecut-persistence-e2e'))).toBe('stored')
    await expect(relaunchedPage.locator('[data-project-card]')).toHaveCount(1)
    await expect.poll(() => relaunchedPage.evaluate(() => window.location.origin)).toBe('luna://app')
    expect(relaunchErrors).toEqual([])
  } finally {
    await relaunched.close().catch(() => undefined)
  }

  expect(runtimeErrors).toEqual([])
})
