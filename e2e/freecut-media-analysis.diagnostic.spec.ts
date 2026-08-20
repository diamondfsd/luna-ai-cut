import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from './fixtures/lunaElectron'

const sourceUserDataDir = process.env.LUNA_E2E_ANALYSIS_SOURCE_USER_DATA_DIR
const existingUserDataDir = process.env.LUNA_E2E_EXISTING_USER_DATA_DIR
const projectId = process.env.LUNA_E2E_ANALYSIS_PROJECT_ID ?? 'MShH08dL'
const mediaId = process.env.LUNA_E2E_ANALYSIS_MEDIA_ID
  ?? 'd17c5bea-4fd8-419c-a203-585306c00394'

test.skip(
  process.env.LUNA_E2E_ANALYSIS_RUN !== '1' || (!sourceUserDataDir && !existingUserDataDir),
  '需要显式设置 LUNA_E2E_ANALYSIS_RUN=1，并提供素材源目录或已有 E2E 用户目录',
)
test.setTimeout(8 * 60_000)

test.use({
  lunaElectronOptions: {
    launchEnv: { LUNA_DISABLE_MODEL_PREFETCH: '1' },
    ...(existingUserDataDir
      ? {}
      : {
          seedProject: {
            sourceUserDataDir: sourceUserDataDir ?? '',
            projectId,
          },
        }),
  },
})

test('诊断素材画面分析的真实失败原因', async ({ lunaApp }) => {
  const { page, runtimeErrors } = lunaApp
  const requestFailures: Array<{ url: string; error: string | null }> = []
  page.on('requestfailed', (request) => {
    requestFailures.push({ url: request.url(), error: request.failure()?.errorText ?? null })
  })

  await page.getByRole('link', { name: '剪辑', exact: true }).click()
  const projectCard = page.locator(`[data-project-card][data-project-id="${projectId}"]`)
  await expect(projectCard).toBeVisible()
  await projectCard.dblclick()
  await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

  const mediaCard = page.locator(`[data-media-id="${mediaId}"]`)
  await expect(mediaCard).toBeVisible({ timeout: 60_000 })
  await mediaCard.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '用 AI 分析' }).click()

  await expect.poll(
    () => mediaCard.getByTitle('正在用 AI 分析').count(),
    { timeout: 5 * 60_000 },
  ).toBeGreaterThan(0)
  await expect.poll(
    () => mediaCard.getByTitle('正在用 AI 分析').count(),
    { timeout: 5 * 60_000 },
  ).toBe(0)

  const metadata = JSON.parse(
    await readFile(path.join(lunaApp.workspaceDir, 'media', mediaId, 'metadata.json'), 'utf8'),
  ) as { aiCaptions?: unknown[] }
  const logFiles = await readdir(path.join(lunaApp.baseDir, 'logs')).catch(() => [])
  const logs = await Promise.all(logFiles.map(async (name) => ({
    name,
    text: await readFile(path.join(lunaApp.baseDir, 'logs', name), 'utf8').catch(() => ''),
  })))

  console.log('ANALYSIS_DIAGNOSTIC ' + JSON.stringify({
    projectId,
    mediaId,
    captions: metadata.aiCaptions?.length ?? 0,
    runtimeErrors,
    requestFailures,
    logs: logs
      .filter(({ text }) => /LFM|Model load failed|worker init|caption|transformers|timeout|handshake|net_error|error/i.test(text))
      .map(({ name, text }) => ({ name, text })),
  }))
})
