import { expect, test } from './fixtures/lunaElectron'

test('Electron 主窗口加载应用与 preload API', async ({ lunaApp }) => {
  await expect(lunaApp.page.locator('#root')).not.toBeEmpty()
  expect(await lunaApp.page.evaluate(() => 'luna' in window)).toBe(true)
  expect(lunaApp.runtimeErrors).toEqual([])
})
