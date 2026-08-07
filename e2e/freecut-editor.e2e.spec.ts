import { expect, test } from './fixtures/lunaElectron'

test('从 Luna 导航创建项目并打开内嵌 FreeCut 剪辑器', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  const navigation = page.locator('.global-nav')

  await expect(navigation).toBeVisible()
  await page.getByRole('link', { name: '剪辑', exact: true }).click()

  await expect(page).toHaveURL(/#\/video-editor$/)
  await expect(page.getByRole('link', { name: '剪辑', exact: true })).toHaveClass(/active/)
  await expect(page.locator('.freecut-app')).toBeVisible()
  const createProject = page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ })
  await expect(createProject).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)

  const navBounds = await navigation.boundingBox()
  const editorBounds = await page.locator('.freecut-app').boundingBox()
  expect(navBounds).not.toBeNull()
  expect(editorBounds).not.toBeNull()
  expect(editorBounds!.y).toBeGreaterThanOrEqual(navBounds!.y + navBounds!.height - 1)

  await createProject.click()

  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  await expect(page.getByRole('application', { name: 'FreeCut 视频编辑器' })).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

test('剪辑助手占用右侧布局并可调整宽度', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()

  const assistantButton = page.getByRole('button', { name: '打开剪辑助手' })
  await expect(assistantButton).toBeVisible()
  await assistantButton.click()

  const assistant = page.getByRole('complementary', { name: '剪辑助手' })
  await expect(assistant).toBeVisible()
  await expect(page.getByPlaceholder('完成设置后开始对话')).toBeDisabled()
  await expect(page.getByRole('button', { name: '去设置' })).toBeVisible()

  const initialBounds = await assistant.boundingBox()
  const resizeHandle = page.getByTestId('ai-editing-resize-handle')
  const handleBounds = await resizeHandle.boundingBox()
  expect(initialBounds).not.toBeNull()
  expect(handleBounds).not.toBeNull()

  await page.mouse.move(handleBounds!.x + 1, handleBounds!.y + 120)
  await page.mouse.down()
  await page.mouse.move(handleBounds!.x - 64, handleBounds!.y + 120)
  await page.mouse.up()

  const resizedBounds = await assistant.boundingBox()
  expect(resizedBounds).not.toBeNull()
  expect(resizedBounds!.width).toBeGreaterThan(initialBounds!.width + 40)

  await page.getByRole('button', { name: '去设置' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '剪辑助手连接' })).toBeVisible()
  const dialogColor = await dialog.evaluate((element) => getComputedStyle(element).color)
  expect(dialogColor).not.toBe('rgb(0, 0, 0)')
  expect(runtimeErrors).toEqual([])
})
