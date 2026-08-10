import { _electron as electron, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import process from 'node:process'

import { expect, test } from './fixtures/lunaElectron'
import { sendTextCompletion, sendToolCallCompletion } from './support/chatCompletionsStream'

const USER_MESSAGE = '给这段生活日常加一个标题'
const ASSISTANT_MARKDOWN = '**标题已经添加到时间轴。**'
const ASSISTANT_MESSAGE = '标题已经添加到时间轴。'
const REFERENCED_USER_MESSAGE = '只检查我引用的资源'

interface ChatCompletionsRequest {
  stream?: unknown
  tool_choice?: unknown
  tools?: Array<{
    type?: unknown
    function?: { name?: unknown; description?: unknown; parameters?: unknown }
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
    const editProgramTool = payload.tools?.find((tool) =>
      tool.type === 'function'
      && typeof tool.function?.name === 'string'
      && typeof tool.function?.description === 'string'
      && tool.function.description.includes('声明式编辑程序'),
    )
    if (requestCount === 0) {
      if (!editProgramTool || typeof editProgramTool.function?.name !== 'string') {
        response.writeHead(400).end(JSON.stringify({ error: { message: 'Expected the edit program tool definition.' } }))
        return
      }
      requestCount += 1
      sendToolCallCompletion(response, {
        id: 'call_add_life_title',
        name: editProgramTool.function.name,
        arguments: JSON.stringify({
          program: {
            version: 1,
            baseRevision: 0,
            intent: '添加生活日常标题',
            operations: [{
              type: 'insertText',
              text: { ref: 'life-title', text: '生活日常', start: 0, duration: 3, role: 'title' },
            }],
          },
        }),
      })
      return
    }
    requestCount += 1
    sendTextCompletion(response, ASSISTANT_MARKDOWN)
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

async function ensureAssistantReady(page: Page) {
  const input = page.getByPlaceholder('描述想要完成的剪辑')
  if (!(await input.isVisible())) {
    const openButton = page.getByRole('button', { name: '打开剪辑助手' })
    if (await openButton.isVisible()) await openButton.click()
  }
  if (!(await input.isVisible())) {
    await page.getByRole('button', { name: '剪辑助手设置' }).click()
    await expect(page.getByRole('dialog', { name: '剪辑助手设置' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await expect(input).toBeEnabled()
  return input
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

    const input = await ensureAssistantReady(page)
    await input.fill(USER_MESSAGE)
    await page.getByRole('button', { name: '发送剪辑请求' }).click()
    await expect(page.getByText(USER_MESSAGE, { exact: true })).toBeVisible()
    const execution = page.getByRole('region', { name: '剪辑执行过程' })
    await expect(execution).toContainText('应用编辑程序')
    await expect(page.locator('[data-timeline-item]')).toHaveCount(1)
    await expect(page.locator('strong', { hasText: ASSISTANT_MESSAGE })).toBeVisible()
    expect(chatMock.requests).toHaveLength(2)
    expect(chatMock.requests[0]?.tool_choice).toBe('auto')
    expect(chatMock.requests[0]?.stream).toBe(true)
    const firstRequest = chatMock.requests[0]
    const firstEditProgramTool = firstRequest?.tools?.find((tool) =>
      tool.type === 'function' && tool.function?.description?.includes('声明式编辑程序'),
    )
    expect(firstEditProgramTool?.function?.name).toBe('fc_workspace_apply_edit_program')
    expect(firstRequest?.tools).toHaveLength(4)
    const schemaTool = firstRequest?.tools?.find(
      (tool) => tool.function?.name === 'fc_workspace_apply_edit_program',
    )
    expect(schemaTool).toBeDefined()
    const editProgramParameters = JSON.stringify(schemaTool?.function?.parameters)
    expect(editProgramParameters).toContain('replaceRange')
    expect(editProgramParameters).toContain('cameraMove')
    expect(editProgramParameters).toContain('insertText')
    expect(firstRequest?.tools?.find((tool) => tool.function?.name === 'fc_tool_describe')).toBeUndefined()
    expect(firstRequest?.tools?.find((tool) => tool.function?.name === 'fc_tool_search')).toBeUndefined()
    expect(firstRequest?.tools?.find((tool) => tool.function?.name === 'fc_skill_search')).toBeUndefined()
    expect(firstRequest?.tools?.find((tool) => tool.function?.name === 'fc_skill_read')).toBeUndefined()
    const systemMessages = firstRequest?.messages?.filter((message) => message.role === 'system') ?? []
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0]?.content).toContain('专业自主 Agent')
    expect(systemMessages[0]?.content).toContain('workspace.apply_edit_program [edit]')
    expect(systemMessages[0]?.content).toContain('EditProgram 协议')
    expect(systemMessages[0]?.content).toContain('AgentWorkspaceDocument')
    expect(systemMessages[0]?.content).toContain('参数:')
    expect(systemMessages[0]?.content).not.toContain('技能工作流')
    expect(systemMessages[0]?.content).not.toContain('本次已选择剪辑技能')
    expect(chatMock.requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({
          id: 'call_add_life_title',
          function: expect.objectContaining({ name: firstEditProgramTool?.function?.name }),
        })],
      }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_add_life_title' }),
    ]))
    await expect(page.getByRole('button', { name: '引用编辑资源' })).toBeVisible()
    await input.fill('@')
    const referencePicker = page.getByRole('listbox', { name: '可引用的编辑资源' })
    await expect(referencePicker.getByRole('option')).not.toHaveCount(0)
    await referencePicker.getByRole('option').first().click()
    await expect(page.getByLabel('已引用的编辑资源').getByRole('button', { name: /移除引用/ })).toHaveCount(1)
    await input.fill(REFERENCED_USER_MESSAGE)
    await page.getByRole('button', { name: '发送剪辑请求' }).click()
    await expect.poll(() => chatMock.requests.length).toBe(3)
    const referencedRequest = chatMock.requests[2]
    const referencedMessage = referencedRequest?.messages?.find((message) =>
      message.role === 'user'
      && typeof message.content === 'string'
      && message.content.includes(REFERENCED_USER_MESSAGE),
    )
    expect(referencedMessage?.content).toContain('用户明确引用的编辑资源')
    expect(referencedMessage?.content).toContain('ID：')
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
      env: { ...process.env, LUNA_E2E_USER_DATA_DIR: userDataDir, LUNA_E2E_FREECUT_STORAGE: 'disk' },
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
    await expect(relaunchedPage.getByText(USER_MESSAGE, { exact: true })).toBeVisible()
    await expect(relaunchedPage.getByText(ASSISTANT_MESSAGE, { exact: true }).first()).toBeVisible()
    await expect(relaunchedPage.getByLabel('引用的编辑资源')).toBeVisible()
    expect(relaunchErrors).toEqual([])
  } finally {
    await relaunched?.close().catch(() => undefined)
    await chatMock.close()
  }

  expect(runtimeErrors).toEqual([])
})
