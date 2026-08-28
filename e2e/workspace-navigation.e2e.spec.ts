import { expect, test } from './fixtures/lunaElectron'

test('工作台详情页可以立即进入设置', async ({ lunaApp }) => {
  const projectName = `工作台导航 ${Date.now()}`
  await lunaApp.page.evaluate(async (name) => {
    await window.luna.workspace.createProject(name)
  }, projectName)

  await lunaApp.page.reload()
  await lunaApp.page.waitForLoadState('domcontentloaded')
  await lunaApp.page.getByRole('link', { name: '工作台', exact: true }).click()

  const project = lunaApp.page.getByRole('button', { name: `${projectName} 0 个素材`, exact: true })
  await expect(project).toBeVisible()
  await project.click()
  await expect(lunaApp.page.locator('.workspace-layout')).toBeVisible()

  await lunaApp.page.getByRole('link', { name: '设置', exact: true }).click()
  await expect.poll(() => lunaApp.page.evaluate(() => window.location.hash)).toBe('#/settings')
  await expect(lunaApp.page.locator('.settings-surface')).toBeVisible()
  await expect(lunaApp.page.locator('.workspace-layout')).toHaveCount(0)
  expect(lunaApp.runtimeErrors).toEqual([])
})
