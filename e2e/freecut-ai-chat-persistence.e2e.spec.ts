import { _electron as electron } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { expect, test } from './fixtures/lunaElectron'

const USER_MESSAGE = '给这段生活日常加一个标题'
const ASSISTANT_MESSAGE = '标题已经添加到时间轴。'

interface ChatCompletionsRequest {
  tool_choice?: unknown
  tools?: Array<{
    type?: unknown
    function?: { name?: unknown; description?: unknown }
  }>
  messages?: Array<{
    role?: unknown
    content?: unknown
    tool_call_id?: unknown
    tool_calls?: Array<{
      id?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }>
  }>
}

async function waitForLunaWindow(app: import('@playwright/test').ElectronApplication) {
  await expect.poll(async () => {
    const page = app.windows()[0]
    return page ? page.evaluate(() => 'luna' in window).catch(() => false) : false
  }).toBe(true)
  return app.windows()[0]!
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<ChatCompletionsRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatCompletionsRequest
}

async function startChatCompletionsMock(): Promise<{
  baseUrl: string
  requests: ChatCompletionsRequest[]
  close: () => Promise<void>
}> {
  let requestCount = 0
  const requests: ChatCompletionsRequest[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const payload = await readRequestBody(request)
    requests.push(payload)
    const describeTool = payload.tools?.find((tool) =>
      tool.type === 'function'
      && typeof tool.function?.name === 'string'
      && typeof tool.function?.description === 'string'
      && tool.function.description.includes('按工具 ID 获取'),
    )
    const titleTool = payload.tools?.find((tool) =>
      tool.type === 'function'
      && typeof tool.function?.name === 'string'
      && typeof tool.function?.description === 'string'
      && tool.function.description.includes('Add a text/title layer'),
    )
    if (requestCount === 0) {
      if (!describeTool || typeof describeTool.function?.name !== 'string') {
        response.writeHead(400).end(JSON.stringify({ error: { message: 'Expected the tool detail definition.' } }))
        return
      }
      requestCount += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_describe_title',
              type: 'function',
              function: { name: describeTool.function.name, arguments: JSON.stringify({ toolIds: ['timeline.add_title'] }) },
            }],
          },
        }],
      }))
      return
    }
    if (requestCount === 1) {
      if (!titleTool || typeof titleTool.function?.name !== 'string') {
        response.writeHead(400).end(JSON.stringify({ error: { message: 'Expected the title tool definition.' } }))
        return
      }
      requestCount += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_add_life_title',
              type: 'function',
              function: { name: titleTool.function.name, arguments: JSON.stringify({ text: '生活日常' }) },
            }],
          },
        }],
      }))
      return
    }
    requestCount += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: ASSISTANT_MESSAGE } }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('无法启动剪辑助手测试服务。')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
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
    const execution = page.getByRole('region', { name: '剪辑执行过程' })
    await expect(execution).toContainText('Add title')
    await expect(page.locator('[data-timeline-item]')).toHaveCount(1)
    await expect(page.getByText(ASSISTANT_MESSAGE, { exact: true })).toBeVisible()
    expect(chatMock.requests).toHaveLength(3)
    expect(chatMock.requests[0]?.tool_choice).toBe('auto')
    const firstRequest = chatMock.requests[0]
    const firstTitleTool = firstRequest?.tools?.find((tool) =>
      tool.type === 'function' && tool.function?.description?.includes('Add a text/title layer'),
    )
    expect(firstTitleTool).toBeUndefined()
    expect(firstRequest?.tools?.length).toBeLessThan(24)
    expect(firstRequest?.tools?.find((tool) => tool.function?.name === 'fc_tool_describe')).toBeDefined()
    const systemMessages = firstRequest?.messages?.filter((message) => message.role === 'system') ?? []
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0]?.content).toContain('timeline.add_title | Add title')
    expect(systemMessages[0]?.content).not.toContain('参数:')
    const secondRequest = chatMock.requests[1]
    const titleTool = secondRequest?.tools?.find((tool) =>
      tool.type === 'function' && tool.function?.description?.includes('Add a text/title layer'),
    )
    expect(titleTool?.function?.name).toBe('fc_timeline_add_title')
    expect(secondRequest?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({
          id: 'call_describe_title',
          function: expect.objectContaining({ name: 'fc_tool_describe' }),
        })],
      }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_describe_title' }),
    ]))
    expect(chatMock.requests[2]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({
          id: 'call_add_life_title',
          function: expect.objectContaining({ name: titleTool?.function?.name }),
        })],
      }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_add_life_title' }),
    ]))
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => undefined },
      })
    })
    await page.getByRole('button', { name: '复制聊天记录' }).last().click()
    await expect(page.getByRole('button', { name: '已复制聊天记录' })).toBeVisible()

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
