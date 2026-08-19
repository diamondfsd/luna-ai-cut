import path from 'node:path'
import { cp, mkdir } from 'node:fs/promises'

import { expect, test } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')

test('媒体库导入不会等待本地文件读取完成', async ({ lunaApp }) => {
  test.setTimeout(120_000)

  const { page, runtimeErrors } = lunaApp
  const mediaPaths = ['sky-01.jpg', 'sky-02.jpg'].map((fileName) =>
    path.join(projectRoot, 'test-data/color-masking/d3-effect-set/images/sky', fileName),
  )
  const localResourcesDir = path.join(lunaApp.baseDir, 'localResources')
  await mkdir(localResourcesDir, { recursive: true })
  await Promise.all(mediaPaths.map((mediaPath) => cp(mediaPath, path.join(localResourcesDir, path.basename(mediaPath)))))

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await page.getByRole('button', { name: /导入媒体/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '导入本地素材' })).toBeVisible()
  const mediaCards = dialog.locator('.media-card')
  await expect(mediaCards).toHaveCount(2, { timeout: 10_000 })
  for (let index = 0; index < 2; index += 1) {
    await mediaCards.nth(index).locator('.select-chip').click()
  }
  await expect(dialog.getByText('已选择 2 个')).toBeVisible()

  const startedAt = Date.now()
  await dialog.getByRole('button', { name: '导入素材', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  const elapsedMs = Date.now() - startedAt

  expect(elapsedMs).toBeLessThan(1_500)
  await expect.poll(() => page.locator('[data-media-id]').count(), { timeout: 30_000 }).toBe(2)
  await expect(page.getByText(/files failed to import/)).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})
