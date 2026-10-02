import { expect, test } from './fixtures/lunaElectron'

test('Electron 主窗口加载应用与 preload API', async ({ lunaApp }) => {
  await expect(lunaApp.page.locator('#root')).not.toBeEmpty()
  expect(await lunaApp.page.evaluate(() => 'luna' in window)).toBe(true)
  const mediaApis = await lunaApp.page.evaluate(() => ({
    secureContext: window.isSecureContext,
    videoDecoder: typeof VideoDecoder,
    videoEncoder: typeof VideoEncoder,
    gpuTextureUsage: typeof (globalThis as typeof globalThis & { GPUTextureUsage?: unknown }).GPUTextureUsage,
  }))
  expect(mediaApis).toEqual({
    secureContext: true,
    videoDecoder: 'function',
    videoEncoder: 'function',
    gpuTextureUsage: 'object',
  })
  expect(lunaApp.runtimeErrors).toEqual([])
})
