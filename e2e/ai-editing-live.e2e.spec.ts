import { expect, test } from './fixtures/lunaElectronLive'
import type { Page } from '@playwright/test'

const enabled = process.env.LUNA_E2E_LIVE === '1'
const projectName = process.env.LUNA_E2E_AI_PROJECT_NAME?.trim()
const shouldImportMedia = Boolean(process.env.LUNA_E2E_WORKSPACE_MEDIA_PATHS?.trim())
const replacementApiKey = process.env.LUNA_E2E_AI_API_KEY?.trim()
const prompt = '请把已有素材剪成一条自然、连贯的生活日常短视频。'

test.setTimeout(20 * 60_000)

async function requestEdit(page: Page, request = prompt) {
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  await expect(input).toBeEnabled()
  await input.fill(request)
  await page.getByRole('button', { name: '发送剪辑请求' }).click()

  const execution = page.getByRole('region', { name: '剪辑执行过程' })
  const error = page.getByRole('alert')
  await Promise.race([
    execution.waitFor({ state: 'visible', timeout: 180_000 }),
    error.waitFor({ state: 'visible', timeout: 180_000 }).then(async () => {
      throw new Error(`剪辑助手执行失败：${await error.innerText()}`)
    }),
  ])
  await expect(input).toBeEnabled({ timeout: 5 * 60_000 })
  return execution
}

async function importConfiguredMediaWhenEmpty(page: Page) {
  if (!shouldImportMedia || await page.locator('[data-media-id]').count() > 0) return

  await page.getByRole('button', { name: '导入', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '导入本地素材' })).toBeVisible()
  await dialog.getByRole('button', { name: '选择本地文件' }).click()
  await expect(dialog).toBeHidden({ timeout: 180_000 })
  await expect.poll(() => page.locator('[data-media-id]').count(), { timeout: 180_000 }).toBeGreaterThan(0)
}

async function replaceAssistantApiKey(page: Page) {
  if (!replacementApiKey) return

  await page.getByRole('button', { name: '剪辑助手连接' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '剪辑助手连接' })).toBeVisible()
  await dialog.getByLabel('API Key').fill(replacementApiKey)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('真实环境剪辑助手', () => {
  test.skip(!enabled, '仅在明确授权的真实环境中运行：LUNA_E2E_LIVE=1')

  test('为指定项目直接生成生活日常视频剪辑', async ({ lunaLiveApp }) => {
    const { page, runtimeErrors } = lunaLiveApp
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await expect(page.locator('.freecut-app')).toBeVisible()

    const projects = page.locator('[data-project-card]')
    const project = projectName
      ? projects.filter({ hasText: projectName })
      : projects
    await expect(
      project,
      projectName
        ? `未找到名为“${projectName}”的 FreeCut 项目。`
        : 'FreeCut 项目列表不是唯一项目；工作台项目需要先导入到剪辑器。',
    ).toHaveCount(1)
    await project.dblclick()

    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
    await importConfiguredMediaWhenEmpty(page)
    await page.getByRole('button', { name: '打开剪辑助手' }).click()
    await expect(page.getByRole('complementary', { name: '剪辑助手' })).toBeVisible()
    await replaceAssistantApiKey(page)

    await requestEdit(page)
    await expect.poll(() => page.locator('[data-timeline-item]').count(), { timeout: 5 * 60_000 }).toBeGreaterThan(0)

    expect(runtimeErrors).toEqual([])
  })

  test('重启后保留已生成的剪辑时间线', async ({ lunaLiveApp }) => {
    test.skip(!projectName, '需要指定已由剪辑助手编辑的项目。')

    const { page, runtimeErrors } = lunaLiveApp
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    const project = page.locator('[data-project-card]').filter({ hasText: projectName })
    await expect(project).toHaveCount(1)
    await project.dblclick()

    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
    await expect.poll(() => page.locator('[data-media-id]').count(), { timeout: 180_000 }).toBeGreaterThan(0)
    await expect.poll(() => page.locator('[data-timeline-item]').count(), { timeout: 180_000 }).toBeGreaterThan(0)
    expect(runtimeErrors).toEqual([])
  })
})
