import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const deviceId = 'dji-pocket-4'
const fileName = 'DJI_20260913_120000_001.JPG'
const httpPort = 18292
const tcpPort = 17292
const udpPort = 19292

test('DJI Mock 支持实时预览与删除原始素材', async ({ lunaApp }) => {
  const mockRoot = path.join(lunaApp.temporaryRoot, 'dji-mock-media')
  const filePath = path.join(mockRoot, fileName)
  const cameraHost = `127.0.0.1:${httpPort}`
  const mockConfig = {
    rootDir: mockRoot,
    host: '127.0.0.1',
    httpPort,
    tcpPort,
    udpPort,
    rateMbps: 30,
  }

  await mkdir(mockRoot, { recursive: true })
  await copyFile(path.resolve(import.meta.dirname, '../public/my-douyin-qr-code.jpg'), filePath)

  await lunaApp.page.evaluate(async (settings) => {
    await window.luna.saveSettings(settings)
  }, {
    activeDeviceId: deviceId,
    cameraHost,
    cameraConnectionMode: 'wireless',
    developerMode: true,
    deviceStorage: { [deviceId]: 'all' },
    mockMediaDir: mockRoot,
    mockHost: '127.0.0.1',
    mockHttpPort: httpPort,
    mockTcpPort: tcpPort,
    mockRateMbps: 30,
    mockServers: { [deviceId]: mockConfig },
  })
  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')

  // The debug page uses this same preload API. Production builds hide its navigation entry,
  // so keep this workflow test independent of the development-only route.
  await lunaApp.page.evaluate((id) => window.luna.startMockServer(id), deviceId)
  await expect.poll(async () => (
    lunaApp.page.evaluate((id) => window.luna.getMockServerStatus(id), deviceId)
  )).toMatchObject({ running: true, cameraHost })

  await lunaApp.page.getByRole('link', { name: '设备媒体库', exact: true }).click()
  await expect(lunaApp.page.getByRole('heading', { name: '连接 Osmo Pocket 4', exact: true })).toBeVisible()
  await lunaApp.page.getByRole('button', { name: '开始连接', exact: true }).click()
  await expect(lunaApp.page.getByText('已无线连接 Osmo Pocket 4', { exact: true })).toBeVisible({ timeout: 45_000 })

  await expect(lunaApp.page.locator('.media-card')).toHaveCount(1, { timeout: 30_000 })
  const previewButton = lunaApp.page.getByRole('button', { name: '打开相机预览', exact: true })
  await expect(previewButton).toBeVisible()
  await previewButton.click()

  const previewDialog = lunaApp.page.locator('.camera-live-preview-dialog')
  await expect(previewDialog).toBeVisible()
  await expect(previewDialog.getByLabel('相机实时画面')).toBeVisible()
  await expect.poll(async () => (
    lunaApp.page.evaluate(({ mode, id, host }) => (
      window.luna.cameraVideoStream.status({ mode, deviceId: id, host })
    ), { mode: 'wireless' as const, id: deviceId, host: cameraHost })
  ).then((status) => status.frames)).toBeGreaterThan(0)

  await previewDialog.locator('.camera-live-preview-footer').getByRole('button', { name: '关闭', exact: true }).click()
  const mediaCard = lunaApp.page.locator('.media-card').first()
  await mediaCard.getByRole('button', { name: `选择 ${fileName}`, exact: true }).click()
  await lunaApp.page.getByRole('button', { name: '删除 (1)', exact: true }).click()

  const deleteDialog = lunaApp.page.getByRole('dialog').filter({ hasText: '删除相机素材' })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(lunaApp.page.locator('.media-card')).toHaveCount(0, { timeout: 30_000 })
  await expect.poll(() => existsSync(filePath)).toBe(false)
  expect(lunaApp.runtimeErrors).toEqual([])
})
