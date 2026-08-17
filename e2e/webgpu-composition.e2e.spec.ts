import { expect, test } from './fixtures/lunaElectron'

test('renders rasterized shape and text layers through WebGPU', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  const secretTrigger = page.getByTitle('相机地址')
  await expect(secretTrigger).toBeVisible()
  await secretTrigger.click({ clickCount: 5, delay: 50 })
  await expect(page.getByText('开发模式', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/webgpu-composition-test'
  })

  const canvas = page.getByTestId('webgpu-composition-canvas')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-status', 'ready', { timeout: 15_000 })

  const dataUrlLength = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement
    return canvasElement.toDataURL('image/png').length
  })
  expect(dataUrlLength).toBeGreaterThan(1_000)
  expect(runtimeErrors).toEqual([])
})
