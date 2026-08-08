import { _electron as electron } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { expect, test } from './fixtures/lunaElectron'

const USER_MESSAGE = '请保留这条项目对话'
const ASSISTANT_MESSAGE = '已记录本地对话。'

async function waitForLunaWindow(app: import('@playwright/test').ElectronApplication) {
  await expect.poll(async () => {
    const page = app.windows()[0]
    return page ? page.evaluate(() => 'luna' in window).catch(() => false) : false
  }).toBe(true)
  return app.windows()[0]!
}

async function startChatCompletionsMock(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: ASSISTANT_MESSAGE, toolCalls: [] }) } }],
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('无法启动剪辑助手测试服务。')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

test('剪辑助手对话会随 FreeCut 项目重启恢复', async ({ lunaApp }) => {
  const { app, page, runtimeErrors, temporaryRoot } = lunaApp
  const chatMock = await startChatCompletionsMock()
  let relaunched: import('@playwright/test').ElectronApplication | undefined

  try {
    await page.getByRole('link', { name: '剪辑', exact: true }).click()
    await page.getByRole('link', { name: /^(创建第一个项目|新建项目)$/ }).click()
    await expect(page.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()

    await page.evaluate((baseUrl) => window.luna.aiEditingAssistant.saveConfig({
      baseUrl,
      model: 'freecut-e2e',
      apiKey: 'e2e-placeholder-key',
    }), chatMock.baseUrl)

    await page.getByRole('button', { name: '打开剪辑助手' }).click()
    const input = page.getByPlaceholder('描述想要完成的剪辑')
    await expect(input).toBeEnabled()
    await input.fill(USER_MESSAGE)
    await page.getByRole('button', { name: '发送剪辑请求' }).click()
    await expect(page.getByText(USER_MESSAGE, { exact: true })).toBeVisible()
    await expect(page.getByText(ASSISTANT_MESSAGE, { exact: true })).toBeVisible()

    await app.close()

    const userDataDir = path.join(temporaryRoot, 'user-data')
    relaunched = await electron.launch({
      args: ['.'],
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, LUNA_E2E_USER_DATA_DIR: userDataDir },
    })
    const relaunchedPage = await waitForLunaWindow(relaunched)
    const relaunchErrors: string[] = []
    relaunchedPage.on('pageerror', (error) => relaunchErrors.push(error.message))
    relaunchedPage.on('console', (message) => {
      if (message.type() === 'error') relaunchErrors.push(message.text())
    })
    await relaunchedPage.getByRole('link', { name: '剪辑', exact: true }).click()
    await expect(relaunchedPage.locator('[data-project-card]')).toHaveCount(1)
    await relaunchedPage.locator('[data-project-card]').dblclick()
    await expect(relaunchedPage.getByRole('toolbar', { name: '编辑器工具栏' })).toBeVisible()
    await relaunchedPage.getByRole('button', { name: '打开剪辑助手' }).click()
    await expect(relaunchedPage.getByText(USER_MESSAGE, { exact: true })).toBeVisible()
    await expect(relaunchedPage.getByText(ASSISTANT_MESSAGE, { exact: true })).toBeVisible()
    expect(relaunchErrors).toEqual([])
  } finally {
    await relaunched?.close().catch(() => undefined)
    await chatMock.close()
  }

  expect(runtimeErrors).toEqual([])
})
