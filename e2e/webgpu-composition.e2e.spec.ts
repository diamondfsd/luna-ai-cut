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

  const revealPixels = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement
    const image = new Image()
    image.src = canvasElement.toDataURL('image/png')
    return image.decode().then(() => {
      const sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = canvasElement.width
      sampleCanvas.height = canvasElement.height
      const context = sampleCanvas.getContext('2d')
      if (!context) throw new Error('无法读取 WebGPU 合成验证画面')
      context.drawImage(image, 0, 0)
      const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
      return {
        visible: sample(180, 275),
        hidden: sample(500, 275),
      }
    })
  })
  expect(revealPixels.visible[0]).toBeGreaterThan(180)
  expect(revealPixels.visible[1]).toBeLessThan(150)
  expect(revealPixels.hidden[0]).toBeLessThan(80)
  expect(revealPixels.hidden[1]).toBeLessThan(100)
  expect(runtimeErrors).toEqual([])
})
