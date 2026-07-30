import { expect, test } from './fixtures/lunaElectron'

test('导航入口自动启动发送到手机并可停止', async ({ lunaApp }) => {
  await lunaApp.page.getByRole('button', { name: '发送到手机' }).click()

  await expect(lunaApp.page.getByRole('dialog', { name: '发送到手机' })).toBeVisible()
  await expect(lunaApp.page.getByRole('img', { name: '发送到手机二维码' })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => lunaApp.page.evaluate(() => window.luna.localMediaShare.getStatus()))
    .toMatchObject({ running: true, qrDataUrl: expect.stringContaining('data:image/png') })

  await lunaApp.page.getByRole('button', { name: '停止发送' }).click()
  await expect(lunaApp.page.getByRole('dialog', { name: '发送到手机' })).toBeHidden()
  await expect.poll(() => lunaApp.page.evaluate(() => window.luna.localMediaShare.getStatus()))
    .toMatchObject({ running: false })
  expect(lunaApp.runtimeErrors).toEqual([])
})
