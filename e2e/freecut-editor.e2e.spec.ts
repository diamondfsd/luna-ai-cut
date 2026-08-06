import { expect, test } from './fixtures/lunaElectron'

test('从 Luna 导航创建项目并打开内嵌 FreeCut 剪辑器', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  const navigation = page.locator('.global-nav')

  await expect(navigation).toBeVisible()
  await page.evaluate(() => localStorage.setItem('freecut-language', 'zh'))
  await page.getByRole('link', { name: '剪辑', exact: true }).click()

  await expect(page).toHaveURL(/#\/video-editor$/)
  await expect(page.getByRole('link', { name: '剪辑', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.freecut-app')).toBeVisible()
  await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)

  const navBounds = await navigation.boundingBox()
  const editorBounds = await page.locator('.freecut-app').boundingBox()
  expect(navBounds).not.toBeNull()
  expect(editorBounds).not.toBeNull()
  expect(editorBounds!.y).toBeGreaterThanOrEqual(navBounds!.y + navBounds!.height - 1)

  await page.getByRole('button', { name: '新建项目' }).click()
  await expect(page.getByRole('heading', { name: '项目详情' })).toBeVisible()
  await page.getByLabel('项目名称').fill('FreeCut E2E 项目')
  await page.getByRole('button', { name: '创建项目' }).click()

  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  await expect(page.getByRole('region', { name: '区域' })).toBeVisible()
  await expect(page.getByText('FreeCut E2E 项目', { exact: true })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})
