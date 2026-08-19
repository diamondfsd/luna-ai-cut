import { readFile } from 'node:fs/promises'

import { expect, test } from './fixtures/lunaElectron'

test.use({
  lunaElectronOptions: {
    launchEnv: {},
    seedHarnessPatch: `- id: ui-jobs
  disabled: true
- insert:
    - id: luna-freecut
      name: /old/freecut-plugin.mjs
      config:
        cwd: /old/sessions
        endpoint: http://127.0.0.1:54819/capability
        token: stale-token
        projectId: stale-project
        model: qwen3.7-plus
`,
  },
})

test('AI 助手右侧栏可以加载 DeepSeek Harness Web', async ({ lunaApp }) => {
  test.setTimeout(120_000)

  const { page, app, runtimeErrors } = lunaApp
  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await expect.poll(() => app.windows().length).toBe(1)
  const assistantPanel = page.getByRole('complementary', { name: 'AI 助手' })

  await expect(assistantPanel.getByRole('heading', { name: 'AI 助手', exact: true })).toBeVisible()
  await expect(assistantPanel.locator('iframe[title="DeepSeek Harness AI 助手"]')).toBeVisible({
    timeout: 60_000,
  })
  await expect(assistantPanel.locator('[role="alert"]')).toHaveCount(0)
  expect(runtimeErrors).toEqual([])

  await assistantPanel.getByRole('button', { name: '关闭 AI 助手', exact: true }).click()
  await expect(assistantPanel).toHaveCount(0)
  await expect(page.locator('.app-layout--assistant-open')).toHaveCount(0)

  const patch = await readFile(
    `${lunaApp.baseDir}/deepseek-harness/cordis.patch.yml`,
    'utf8',
  )
  expect(patch).not.toContain('luna-freecut')
})
