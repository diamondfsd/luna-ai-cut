import { expect, test } from './fixtures/lunaElectron'

test('collects a WebGPU capability and frame baseline', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  await page.evaluate(() => {
    window.location.hash = '#/settings'
  })
  const secretTrigger = page.getByTitle('相机地址')
  await expect(secretTrigger).toBeVisible()
  await secretTrigger.click({ clickCount: 5, delay: 50 })
  await expect(page.getByText('开发模式', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/webgpu-diagnostics'
  })

  const output = page.getByTestId('webgpu-diagnostics-output')
  await expect(output).toBeVisible()
  await expect.poll(async () => {
    const raw = await output.textContent()
    return raw ? JSON.parse(raw) as { runtime?: unknown; benchmark?: { frameCount?: number } } : null
  }, { timeout: 30_000 }).toMatchObject({
    runtime: expect.any(Object),
    benchmark: { frameCount: expect.any(Number) },
  })
  expect(runtimeErrors).toEqual([])
})
