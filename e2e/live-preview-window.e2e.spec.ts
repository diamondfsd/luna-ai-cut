import { expect, test } from './fixtures/lunaElectron'

test('直播模式在独立方角窗口显示并可从控制台关闭', async ({ lunaApp }) => {
  const rendererErrors: string[] = []

  await lunaApp.page.evaluate(() => { window.location.hash = '#/live-console' })
  await expect(lunaApp.page.getByRole('heading', { name: '直播控制台' })).toBeVisible()
  await expect(lunaApp.page.locator('.app-window-titlebar')).toHaveCount(0)
  await lunaApp.page.getByRole('button', { name: '直播模式', exact: true }).click()

  await expect.poll(() => lunaApp.app.windows().length).toBe(2)
  const previewWindow = lunaApp.app.windows().find((candidate) => candidate !== lunaApp.page)
  expect(previewWindow).toBeTruthy()
  previewWindow!.on('pageerror', (error) => rendererErrors.push(error.message))
  previewWindow!.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text())
  })

  await expect(previewWindow!.locator('.live-preview-window')).toBeVisible()
  await expect.poll(() => previewWindow!.evaluate(async () => {
    const settings = await window.luna.getLivePreviewWindowSettings()
    return settings?.colorAdjustments.exposure ?? null
  })).toBe(0)
  await expect(lunaApp.page.getByRole('navigation').getByRole('link', { name: '设备媒体库' })).toBeVisible()
  await expect(lunaApp.page.getByRole('button', { name: '退出直播模式', exact: true })).toBeVisible()

  await lunaApp.page.getByRole('button', { name: '退出直播模式', exact: true }).click()
  await expect.poll(() => lunaApp.app.windows().length).toBe(1)
  await expect(lunaApp.page.getByRole('button', { name: '直播模式', exact: true })).toBeVisible()
  expect(rendererErrors).toEqual([])
  expect(lunaApp.runtimeErrors).toEqual([])
})
