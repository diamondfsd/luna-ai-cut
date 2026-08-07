import { _electron as electron } from '@playwright/test'
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

test.use({
  lunaElectronOptions: {
    launchEnv: { LUNA_E2E_RENDERER_ORIGIN: 'file' },
  },
})

test('升级后会迁移旧版 FreeCut 项目', async ({ lunaApp }) => {
  const { app, page, runtimeErrors, temporaryRoot } = lunaApp

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  const binarySize = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const workspace = await root.getDirectoryHandle('luna-freecut')
    const verification = await workspace.getDirectoryHandle('migration-verification', { create: true })
    const handle = await verification.getFileHandle('bytes.bin', { create: true })
    const bytes = new Uint8Array(512 * 1024 + 1)
    bytes[0] = 11
    bytes[512 * 1024] = 29
    const writable = await handle.createWritable()
    await writable.write(bytes)
    await writable.close()
    return bytes.byteLength
  })
  await app.close()

  const userDataDir = path.join(temporaryRoot, 'user-data')
  const relaunched = await electron.launch({
    args: ['.'],
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, LUNA_E2E_USER_DATA_DIR: userDataDir },
  })
  try {
    const relaunchedPage = await waitForLunaWindow(relaunched)
    await relaunchedPage.getByRole('link', { name: '剪辑', exact: true }).click()

    await expect(relaunchedPage.locator('[data-project-card]')).toHaveCount(1)
    await expect.poll(() => relaunchedPage.evaluate(() => window.location.origin)).toBe('luna://app')
    await expect.poll(() => relaunchedPage.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const workspace = await root.getDirectoryHandle('luna-freecut')
      const verification = await workspace.getDirectoryHandle('migration-verification')
      const handle = await verification.getFileHandle('bytes.bin')
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer())
      return [bytes.byteLength, bytes[0], bytes[512 * 1024]]
    })).toEqual([binarySize, 11, 29])
  } finally {
    await relaunched.close().catch(() => undefined)
  }

  expect(runtimeErrors).toEqual([])
})
