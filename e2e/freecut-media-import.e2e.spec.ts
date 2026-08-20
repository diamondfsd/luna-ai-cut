import path from 'node:path'
import { cp, mkdir, readdir } from 'node:fs/promises'

import { expect, test } from './fixtures/lunaElectron'

const projectRoot = path.resolve(import.meta.dirname, '..')

async function countPersistedMedia(workspaceDir: string): Promise<number> {
  const mediaDir = path.join(workspaceDir, 'media')
  const entries = await readdir(mediaDir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).length
}

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
  await expect.poll(() => countPersistedMedia(lunaApp.workspaceDir), { timeout: 90_000 }).toBe(2)
  await expect.poll(() => page.locator('[data-media-id]').count(), { timeout: 30_000 }).toBe(2)
  await expect(page.getByText(/files failed to import/)).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})

test('从本地资源库卡片导入真实 MP4', async ({ lunaApp }) => {
  test.setTimeout(180_000)

  const configuredPaths = process.env.LUNA_E2E_WORKSPACE_MEDIA_PATHS
    ?.split(path.delimiter)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
  test.skip(!configuredPaths?.length, '需要通过 LUNA_E2E_WORKSPACE_MEDIA_PATHS 提供真实视频文件')

  const localResourcesDir = path.join(lunaApp.baseDir, 'localResources')
  await mkdir(localResourcesDir, { recursive: true })
  await Promise.all(configuredPaths!.map((mediaPath) =>
    cp(mediaPath, path.join(localResourcesDir, path.basename(mediaPath))),
  ))

  const { page, runtimeErrors } = lunaApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await page.getByRole('button', { name: /导入媒体/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '导入本地素材' })).toBeVisible()
  const mediaCards = dialog.locator('.media-card')
  await expect(mediaCards).toHaveCount(configuredPaths!.length, { timeout: 30_000 })
  for (let index = 0; index < configuredPaths!.length; index += 1) {
    await mediaCards.nth(index).locator('.select-chip').click()
  }
  await expect(dialog.getByText(`已选择 ${configuredPaths!.length} 个`)).toBeVisible()

  await dialog.getByRole('button', { name: '导入素材', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  await expect.poll(() => countPersistedMedia(lunaApp.workspaceDir), { timeout: 120_000 }).toBe(configuredPaths!.length)
  await expect.poll(() => page.locator('[data-media-id]').count(), { timeout: 30_000 }).toBe(configuredPaths!.length)
  await expect(page.getByText(/files failed to import/)).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
})
