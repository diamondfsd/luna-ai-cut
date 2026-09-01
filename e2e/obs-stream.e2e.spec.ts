import { expect, test } from './fixtures/lunaElectron'

test('OBS 演示页可以启动循环 MP4 视频流', async ({ lunaApp }) => {
  await lunaApp.page.evaluate(() => { window.location.hash = '#/obs-stream' })
  await expect(lunaApp.page.getByRole('heading', { name: 'OBS 推流演示' })).toBeVisible()
  await expect(lunaApp.page.getByRole('heading', { name: 'MP4 测试源' })).toBeVisible()

  await lunaApp.page.getByRole('button', { name: '开始推流' }).click()
  await expect(lunaApp.page.getByText('推流中', { exact: true })).toBeVisible()
  await expect.poll(() => lunaApp.page.locator('.obs-stream-stage video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2)

  const streamUrl = await lunaApp.page.getByLabel('OBS 媒体源地址').inputValue()
  expect(streamUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/stream$/)

  const controller = new AbortController()
  const response = await fetch(streamUrl, { signal: controller.signal })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('video/mp2t')
  const firstChunk = await response.body?.getReader().read()
  expect(firstChunk?.done).toBe(false)
  expect(firstChunk?.value?.byteLength ?? 0).toBeGreaterThan(0)
  controller.abort()

  await expect.poll(() => lunaApp.page.evaluate(() => window.luna.obsStreamDemo.status().then((next) => next.bytes))).toBeGreaterThan(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
