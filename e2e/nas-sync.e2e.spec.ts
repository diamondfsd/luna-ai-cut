import { expect, test } from './fixtures/lunaElectron'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

test('真实 NAS 可连接、选择目录并同步本地文件', async ({ lunaApp }) => {
  const fileName = `LUNA_NAS_E2E_${Date.now()}.png`
  const localResourcesDir = path.join(lunaApp.temporaryRoot, 'downloads', 'localResources')
  const localFilePath = path.join(localResourcesDir, fileName)
  await mkdir(localResourcesDir, { recursive: true })
  await copyFile(path.resolve(import.meta.dirname, '..', 'build', 'icon.png'), localFilePath)
  const localStats = await stat(localFilePath)

  const page = lunaApp.page
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.locator('.nas-settings-card')).toBeVisible()

  const form = page.locator('.nas-settings-form')
  const fields = form.getByRole('textbox')
  await fields.nth(0).fill('192.168.31.31')
  await fields.nth(1).fill(process.env.LUNA_NAS_USERNAME ?? '')
  await fields.nth(2).fill(process.env.LUNA_NAS_PASSWORD ?? '')
  await page.getByRole('button', { name: '连接并选择目录', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '选择同步目录' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  const shareSelect = dialog.getByRole('button', { name: '请选择共享目录' })
  await shareSelect.click()
  const shareOptions = page.getByRole('option')
  await expect(shareOptions.first()).toBeVisible({ timeout: 15_000 })
  const requestedShare = process.env.LUNA_NAS_SHARE
  const selectedShareOption = requestedShare
    ? page.getByRole('option', { name: requestedShare, exact: true })
    : shareOptions.first()
  const selectedShare = (await selectedShareOption.textContent())?.trim()
  expect(selectedShare).toBeTruthy()
  await selectedShareOption.click()

  const directorySelect = dialog.getByRole('button', { name: '请选择同步目录' })
  await expect(directorySelect).toBeEnabled({ timeout: 30_000 })
  await directorySelect.click()
  const directoryOptions = page.getByRole('option')
  await expect(directoryOptions.first()).toBeVisible({ timeout: 15_000 })
  const requestedDirectory = process.env.LUNA_NAS_REMOTE_PATH
  const selectedDirectoryOption = requestedDirectory === '/'
    ? page.getByRole('option', { name: '共享根目录', exact: true })
    : requestedDirectory
      ? page.getByRole('option', { name: requestedDirectory, exact: true })
      : directoryOptions.first()
  const selectedDirectory = (await selectedDirectoryOption.textContent())?.trim()
  expect(selectedDirectory).toBeTruthy()
  await selectedDirectoryOption.click()
  await dialog.getByRole('button', { name: '选择目录', exact: true }).click()
  await expect(page.locator('.nas-selected-directory strong')).toHaveText(`${selectedShare} / ${selectedDirectory}`)

  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect.poll(async () => (await page.evaluate(() => window.luna.getSettings())).nasSync?.remotePath)
    .toBe(requestedDirectory === '/' ? '/' : selectedDirectory)

  await page.getByRole('switch', { name: '启用 NAS 同步' }).click()
  await expect.poll(async () => (await page.evaluate(() => window.luna.getSettings())).nasSync?.enabled)
    .toBe(true)

  await page.getByRole('link', { name: '本地资源', exact: true }).click()
  const card = page.locator('.media-card').filter({ hasText: fileName }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.locator('.select-chip').click()
  await page.getByRole('button', { name: /同步到 NAS/ }).click()

  await expect.poll(async () => (await page.evaluate(() => window.luna.nasSync.getStatus())), { timeout: 60_000 })
    .toMatchObject({ state: 'ready', pendingFiles: 0, failedFiles: 0, completedFiles: 1 })

  const remoteFiles = await page.evaluate(() => window.luna.nasSync.listFiles())
  expect(remoteFiles).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: fileName, size: localStats.size }),
  ]))
  expect(lunaApp.runtimeErrors).toEqual([])
})
