import path from 'node:path'
import { mkdir, readdir } from 'node:fs/promises'

import { expect, test } from './fixtures/lunaElectron'

async function projectDirectoryCount(workspaceDir: string): Promise<number> {
  const entries = await readdir(path.join(workspaceDir, 'projects'), { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).length
}

test('FreeCut 项目使用设置中的基础目录落盘', async ({ lunaApp }) => {
  const { page, runtimeErrors, baseDir, temporaryRoot } = lunaApp
  const selectedBaseDir = path.join(temporaryRoot, 'selected-base-dir')
  const selectedWorkspaceDir = path.join(selectedBaseDir, 'freecut-workspace')
  await mkdir(selectedBaseDir, { recursive: true })

  const savedBaseDir = await page.evaluate(async (nextBaseDir) => {
    const settings = await window.luna.saveSettings({ baseDir: nextBaseDir })
    return settings.baseDir
  }, selectedBaseDir)
  expect(savedBaseDir).toBe(selectedBaseDir)

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await expect.poll(() => projectDirectoryCount(selectedWorkspaceDir)).toBe(1)
  await expect.poll(() => projectDirectoryCount(path.join(baseDir, 'freecut-workspace'))).toBe(0)
  expect(runtimeErrors).toEqual([])
})
