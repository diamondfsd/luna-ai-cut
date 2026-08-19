import { expect, test } from './fixtures/lunaElectron'

test('编辑工作区的媒体面板位于上方且时间轴横向铺满', async ({ lunaApp }) => {
  test.setTimeout(120_000)

  const { page, runtimeErrors } = lunaApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
  await expect(page.locator('[data-timeline-root]')).toBeVisible({ timeout: 15_000 })

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) return null
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    return {
      media: rect('[data-editor-media-sidebar]'),
      preview: rect('[data-editor-preview]'),
      timeline: rect('[data-editor-timeline]'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }
  })

  console.log(`编辑器布局: ${JSON.stringify(layout)}`)
  await page.screenshot({ path: test.info().outputPath('freecut-editor-layout.png'), fullPage: false })

  expect(layout.media).not.toBeNull()
  expect(layout.preview).not.toBeNull()
  expect(layout.timeline).not.toBeNull()
  expect(layout.media!.y).toBeGreaterThan(layout.preview!.y - 1)
  expect(layout.timeline!.x).toBeLessThanOrEqual(1)
  expect(layout.timeline!.width).toBeGreaterThanOrEqual(layout.viewport.width - 2)
  expect(layout.timeline!.y).toBeGreaterThan(layout.preview!.y)
  expect(runtimeErrors).toEqual([])
})
