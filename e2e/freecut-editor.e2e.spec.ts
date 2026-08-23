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
  const timelineViewport = page.locator('[data-timeline-scroll-container]')
  const rulerSurface = page.locator('[data-timeline-committed-surface="ruler"]')
  await expect.poll(async () => {
    const [viewportWidth, rulerWidth] = await Promise.all([
      timelineViewport.evaluate((element) => element.clientWidth),
      rulerSurface.evaluate((element) => element.getBoundingClientRect().width),
    ])
    const trailingRoom = Math.max(240, Math.min(480, viewportWidth * 0.35))
    const pixelsPerSecond = (rulerWidth - trailingRoom) / 60
    return viewportWidth / pixelsPerSecond
  }).toBeGreaterThanOrEqual(55)
  expect(runtimeErrors).toEqual([])
})

test('AI 助手占用右侧布局并可关闭', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()

  const assistantButton = page.getByRole('button', { name: 'AI 助手', exact: true })
  await expect(assistantButton).toBeVisible()
  await assistantButton.click()

  const assistant = page.getByRole('complementary', { name: 'AI 助手' })
  await expect(assistant).toBeVisible()
  await expect(assistant.locator('iframe[title="DeepSeek Harness AI 助手"]')).toBeVisible()
  await expect(page.locator('.app-layout--assistant-open')).toBeVisible()

  const assistantBounds = await assistant.boundingBox()
  expect(assistantBounds).not.toBeNull()
  expect(assistantBounds!.width).toBeGreaterThan(300)

  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click()
  await expect(assistant).toBeHidden()
  expect(runtimeErrors).toEqual([])
})
