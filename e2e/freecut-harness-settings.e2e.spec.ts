import { expect, test } from './fixtures/lunaElectron'

test('嵌入的 Harness 保留原生侧栏并能打开原生设置', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const harnessFrameElement = page.locator('iframe[title="DeepSeek Harness"]')
  await expect(harnessFrameElement).toBeVisible({ timeout: 60_000 })
  const harness = page.frameLocator('iframe[title="DeepSeek Harness"]')

  const openSidebar = harness.getByRole('button', { name: '打开侧边栏', exact: true })
  const collapseSidebar = harness.getByRole('button', { name: '收起侧边栏', exact: true })
  await expect(openSidebar.or(collapseSidebar)).toBeVisible({ timeout: 30_000 })
  if (await openSidebar.isVisible()) await openSidebar.click()

  await expect(harness.getByRole('button', { name: '设置', exact: true })).toBeVisible()
  await harness.getByRole('button', { name: '设置', exact: true }).click()
  await expect(harness.getByRole('dialog')).toBeVisible()
  await expect(harness.getByRole('button', { name: '模型', exact: true })).toBeVisible()

  expect(runtimeErrors).toEqual([])
})
