import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false)
}

test('LRC 仅在首次使用时初始化', async ({ lunaApp }) => {
  const { page, runtimeErrors, userDataDir, baseDir } = lunaApp
  const guardPath = path.join(userDataDir, '.lrc-init-running.json')
  const logDirectory = path.join(baseDir, 'logs')

  await expect(page.getByRole('main')).toBeVisible()
  await page.waitForTimeout(500)
  expect(await exists(guardPath)).toBe(false)
  const logsBeforeUse = await readdir(logDirectory).catch(() => [])
  expect(logsBeforeUse).not.toContain('luna-rc.log')

  await page.evaluate(() => window.lunaRenderCore.init())

  await expect.poll(() => exists(path.join(logDirectory, 'luna-rc.log'))).toBe(true)
  expect(await exists(guardPath)).toBe(false)
  expect(runtimeErrors).toEqual([])
})
